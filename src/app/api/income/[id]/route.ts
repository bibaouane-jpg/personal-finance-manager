import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { appendLedgerEntry, getWalletBalance } from '@/lib/ledger'
import { audit } from '@/lib/audit'
import { parseLocalDate, isPositiveMoney, toCents, fromCents, subMoney } from '@/lib/money'

const UpdateIncomeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  articleId: z.string().min(1).nullable().optional(),
  amount: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid amount')
    .optional(),
  walletId: z.string().min(1).optional(),
  financialDate: z.string().min(1).optional(),
  comment: z.string().max(280).nullable().optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/income/[id] — return one income with relations. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const income = await db.incomeTransaction.findFirst({
      where: { id, userId },
      include: { category: true, article: true, wallet: true },
    })
    if (!income) {
      return fail('Income transaction not found.', 404)
    }
    return ok(serialize(income))
  })(req)
}

/** PUT /api/income/[id] — update income with ledger reconciliation. */
export async function PUT(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.incomeTransaction.findFirst({
      where: { id, userId },
      include: { wallet: true },
    })
    if (!existing) {
      return fail('Income transaction not found.', 404)
    }

    const parsed = UpdateIncomeSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    // Validate amount if provided.
    if (data.amount !== undefined && !isPositiveMoney(data.amount)) {
      return fail('Amount must be greater than zero.', 400)
    }

    let result: { income: any; walletId: string } | null = null
    try {
      result = await db.$transaction(async (tx) => {
        const oldAmount = existing.amount
        const oldWalletId = existing.walletId

        const newAmount = data.amount ?? oldAmount
        const newWalletId = data.walletId ?? oldWalletId
        const newFinancialDate = data.financialDate
          ? parseLocalDate(data.financialDate)
          : existing.financialDate

        // Resolve category.
        let categoryId = data.categoryId === undefined ? existing.categoryId : data.categoryId
        if (data.articleId !== undefined) {
          const newArticleId = data.articleId
          if (newArticleId) {
            const article = await tx.article.findFirst({
              where: { id: newArticleId, userId },
            })
            if (!article) throw new Error('Article not found.')
            if (!categoryId && article.defaultCategoryId) {
              categoryId = article.defaultCategoryId
            }
          }
        }
        if (categoryId) {
          const cat = await tx.category.findFirst({ where: { id: categoryId, userId } })
          if (!cat) throw new Error('Category not found.')
          if (cat.type !== 'income') {
            throw new Error('Category must be of type income.')
          }
        }

        // Validate the destination wallet (if changed or new).
        const targetWallet = await tx.wallet.findFirst({
          where: { id: newWalletId, userId },
        })
        if (!targetWallet) throw new Error('Wallet not found.')
        if (!targetWallet.active) throw new Error('Wallet is not active.')

        const walletChanged = newWalletId !== oldWalletId
        const amountChanged = toCents(newAmount) !== toCents(oldAmount)

        if (walletChanged) {
          // Reverse the FULL old amount on the old wallet (debit) ...
          await appendLedgerEntry(tx, {
            walletId: oldWalletId,
            userId,
            amount: subMoney('0', oldAmount), // negative
            operationType: 'adjustment',
            direction: 'debit',
            referenceType: 'income',
            referenceId: id,
            financialDate: newFinancialDate,
            comment: `Reversal for income edit (${existing.name})`,
          })
          // ... and apply the FULL new amount as credit on the new wallet.
          await appendLedgerEntry(tx, {
            walletId: newWalletId,
            userId,
            amount: fromCents(toCents(newAmount)),
            operationType: 'income',
            direction: 'credit',
            referenceType: 'income',
            referenceId: id,
            financialDate: newFinancialDate,
            comment: data.comment ?? existing.comment ?? undefined,
          })
        } else if (amountChanged) {
          // Same wallet: append a single signed adjustment for the difference.
          const diffCents = toCents(newAmount) - toCents(oldAmount)
          const diffStr = fromCents(diffCents)
          await appendLedgerEntry(tx, {
            walletId: oldWalletId,
            userId,
            amount: diffStr, // signed
            operationType: 'adjustment',
            direction: diffCents >= 0 ? 'credit' : 'debit',
            referenceType: 'income',
            referenceId: id,
            financialDate: newFinancialDate,
            comment: `Income adjustment (${existing.name})`,
          })
        }

        const updated = await tx.incomeTransaction.update({
          where: { id },
          data: {
            name: data.name ?? undefined,
            categoryId: categoryId === undefined ? undefined : (categoryId ?? null),
            articleId: data.articleId === undefined ? undefined : (data.articleId ?? null),
            amount: newAmount,
            walletId: newWalletId,
            financialDate: newFinancialDate,
            comment: data.comment === undefined ? undefined : (data.comment ?? null),
          },
          include: { category: true, article: true, wallet: true },
        })

        return { income: updated, walletId: newWalletId }
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update income.'
      return fail(message, 400)
    }

    await audit({
      userId,
      entityType: 'IncomeTransaction',
      entityId: id,
      operation: 'update',
      previousValues: serialize(existing),
      newValues: serialize(result.income),
      reason: `Income updated: ${result.income.name}`,
    })

    // Compute the wallet balance AFTER the transaction commits so the read
    // reflects the just-applied ledger entry.
    const walletBalance = await getWalletBalance(result.walletId)

    return ok(serialize({ income: result.income, walletBalance }))
  })(req)
}

/** DELETE /api/income/[id] — reverse the credit then hard-delete the income row. */
export async function DELETE(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.incomeTransaction.findFirst({
      where: { id, userId },
    })
    if (!existing) {
      return fail('Income transaction not found.', 404)
    }

    let walletBalance = '0.00'
    try {
      // Transaction only does writes; the wallet balance is recomputed AFTER
      // commit so the read reflects the just-applied reversal ledger entry.
      await db.$transaction(async (tx) => {
        // Reverse the original credit with a debit of the same magnitude.
        await appendLedgerEntry(tx, {
          walletId: existing.walletId,
          userId,
          amount: subMoney('0', existing.amount), // negative
          operationType: 'adjustment',
          direction: 'debit',
          referenceType: 'income',
          referenceId: id,
          financialDate: existing.financialDate,
          comment: `Reversal on income deletion (${existing.name})`,
        })

        await tx.incomeTransaction.delete({ where: { id } })
      })
      walletBalance = await getWalletBalance(existing.walletId)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to delete income.'
      return fail(message, 400)
    }

    await audit({
      userId,
      entityType: 'IncomeTransaction',
      entityId: id,
      operation: 'delete',
      previousValues: serialize(existing),
      reason: `Income deleted: ${existing.name}`,
    })

    return ok(serialize({ ok: true, walletBalance }))
  })(req)
}
