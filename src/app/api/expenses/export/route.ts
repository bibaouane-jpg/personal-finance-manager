import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { audit } from '@/lib/audit'
import { parseLocalDate } from '@/lib/money'

function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  let v = String(value)
  // Formula-injection guard.
  if (/^[=+\-@]/.test(v)) {
    v = `'${v}`
  }
  // Wrap in quotes and escape embedded quotes/newlines.
  if (/[",\n\r]/.test(v)) {
    v = `"${v.replace(/"/g, '""')}"`
  }
  return v
}

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
    where.OR = [{ name: { contains: search } }, { comment: { contains: search } }]
  }
  return where
}

/** GET /api/expenses/export — export filtered expenses as CSV. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const url = new URL(req.url)
    const where = buildWhere(userId, url)

    const items = await db.expenseTransaction.findMany({
      where,
      orderBy: [{ financialDate: 'desc' }, { createdAt: 'desc' }],
      include: { category: true, article: true, wallet: true },
    })

    const header = ['Date', 'Name', 'Category', 'Article', 'Wallet', 'Amount', 'Comment']
    const rows = items.map((it) => {
      const d =
        it.financialDate instanceof Date ? it.financialDate : new Date(it.financialDate)
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
        2,
        '0'
      )}-${String(d.getUTCDate()).padStart(2, '0')}`
      return [
        escapeCsvCell(dateStr),
        escapeCsvCell(it.name),
        escapeCsvCell(it.category?.name ?? ''),
        escapeCsvCell(it.article?.name ?? ''),
        escapeCsvCell(it.wallet?.name ?? ''),
        escapeCsvCell(it.amount),
        escapeCsvCell(it.comment ?? ''),
      ].join(',')
    })

    const csv = [header.join(','), ...rows].join('\r\n')

    await audit({
      userId,
      entityType: 'ExpenseTransaction',
      entityId: 'export',
      operation: 'update',
      newValues: { count: items.length, filters: Object.fromEntries(url.searchParams) },
      reason: `Exported ${items.length} expense rows to CSV`,
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="expenses.csv"',
      },
    })
  })(req)
}
