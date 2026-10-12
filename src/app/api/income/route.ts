import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { appendLedgerEntry, getWalletBalance } from '@/lib/ledger'
import { audit } from '@/lib/audit'
import { parseLocalDate, isPositiveMoney, fromCents, toCents } from '@/lib/money'

const CreateIncomeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120, 'Name is too long.'),
  categoryId: z.string().min(1).optional(),
  articleId: z.string().min(1).optional(),
  amount: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid amount')
    .refine((v) => Number(v) > 0, 'Amount must be greater than zero.'),
  walletId: z.string().min(1, 'Wallet is required.'),
  financialDate: z.string().min(1, 'Financial date is required.'),
  comment: z.string().max(280).optional(),
})

const SORT_VALUES = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'] as const

function buildWhere(userId: string, url: URL) {
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const walletId = url.searchParams.get('walletId')
  const categoryId = url.searchParams.get('categoryId')
  const articleId = url.searchParams.get('articleId')
  const search = url.searchParams.get('search')?.trim() || ''

  const where: Record<string, unknown> = { userId }
  if (from || to) {
    const range: Record<string, unknown> = {}
    if (from) range.gte = parseLocalDate(from)
    if (to) {
      // Include the whole end day.
      const endDate = parseLocalDate(to)
      endDate.setUTCHours(23, 59, 59, 999)
      range.lte = endDate
    }
    where.financialDate = range
  }
  if (walletId) where.walletId = walletId
  if (categoryId) where.categoryId = categoryId
  if (articleId) where.articleId = articleId
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { comment: { contains: search } },
    ]
  }
  return where
}

/** GET /api/income — list income with filters and pagination. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const url = new URL(req.url)
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10) || 20)
    )
    const sortRaw = url.searchParams.get('sort') || 'date_desc'
    const sort = (SORT_VALUES as readonly string[]).includes(sortRaw) ? sortRaw : 'date_desc'

    const orderBy: Record<string, 'asc' | 'desc'>[] =
      sort === 'date_asc'
        ? [{ financialDate: 'asc' }, { createdAt: 'asc' }]
        : sort === 'amount_desc'
        ? [{ amount: 'desc' }]
        : sort === 'amount_asc'
        ? [{ amount: 'asc' }]
        : [{ financialDate: 'desc' }, { createdAt: 'desc' }]

    const where = buildWhere(userId, url)
    const [items, total] = await Promise.all([
      db.incomeTransaction.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: true, article: true, wallet: true },
      }),
      db.incomeTransaction.count({ where }),
    ])

    return ok(serialize({ items, total, page, pageSize }))
  })(req)
}

/** POST /api/income — create an income transaction + ledger credit. */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = CreateIncomeSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    if (!isPositiveMoney(data.amount)) {
      return fail('Amount must be greater than zero.', 400)
    }

    let result: { income: any; walletId: string } | null = null
    try {
      result = await db.$transaction(async (tx) => {
        const wallet = await tx.wallet.findFirst({
          where: { id: data.walletId, userId },
        })
        if (!wallet) throw new Error('Wallet not found.')
        if (!wallet.active) throw new Error('Wallet is not active.')

        // Resolve category: explicit > article.defaultCategoryId
        let categoryId = data.categoryId
        let article: any = null
        if (data.articleId) {
          article = await tx.article.findFirst({
            where: { id: data.articleId, userId },
          })
          if (!article) throw new Error('Article not found.')
          if (!categoryId && article.defaultCategoryId) {
            categoryId = article.defaultCategoryId
          }
        }

        // Validate category (if any) belongs to user and is income type.
        if (categoryId) {
          const cat = await tx.category.findFirst({
            where: { id: categoryId, userId },
          })
          if (!cat) throw new Error('Category not found.')
          if (cat.type !== 'income') {
            throw new Error('Category must be of type income.')
          }
        }

        const financialDate = parseLocalDate(data.financialDate)

        const income = await tx.incomeTransaction.create({
          data: {
            userId,
            name: data.name,
            categoryId: categoryId ?? null,
            articleId: data.articleId ?? null,
            amount: data.amount,
            walletId: wallet.id,
            financialDate,
            comment: data.comment ?? null,
          },
          include: { category: true, article: true, wallet: true },
        })

        const entry = await appendLedgerEntry(tx, {
          walletId: wallet.id,
          userId,
          amount: fromCents(toCents(data.amount)), // canonical positive string
          operationType: 'income',
          direction: 'credit',
          referenceType: 'income',
          referenceId: income.id,
          financialDate,
          comment: data.comment ?? undefined,
        })

        const updated = await tx.incomeTransaction.update({
          where: { id: income.id },
          data: { ledgerEntryId: entry.id },
          include: { category: true, article: true, wallet: true },
        })

        return { income: updated, walletId: wallet.id }
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to create income.'
      return fail(message, 400)
    }

    await audit({
      userId,
      entityType: 'IncomeTransaction',
      entityId: result.income.id,
      operation: 'create',
      newValues: serialize(result.income),
      reason: `Income recorded: ${result.income.name} (${result.income.amount})`,
    })

    // Compute the wallet balance AFTER the transaction commits so the read
    // reflects the just-applied ledger entry.
    const walletBalance = await getWalletBalance(result.walletId)

    return ok(serialize({ income: result.income, walletBalance }), 201)
  })(req)
}
