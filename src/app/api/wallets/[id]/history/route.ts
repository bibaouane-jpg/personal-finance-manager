import { db } from '@/lib/db'
import { withAuth, ok, serialize } from '@/lib/api'
import { parseLocalDate } from '@/lib/money'

type Params = { params: Promise<{ id: string }> }

/** GET /api/wallets/[id]/history — paginated ledger entries for the wallet. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const wallet = await db.wallet.findFirst({ where: { id, userId } })
    if (!wallet) {
      return ok(serialize({ items: [], total: 0, page: 1, pageSize: 20 }))
    }

    const url = new URL(req.url)
    const fromRaw = url.searchParams.get('from')
    const toRaw = url.searchParams.get('to')
    const search = url.searchParams.get('search')?.trim() || ''
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '20', 10) || 20)
    )

    const where: {
      walletId: string
      financialDate?: { gte?: Date; lte?: Date }
      comment?: { contains: string }
    } = { walletId: id }

    if (fromRaw) {
      try {
        where.financialDate = { ...(where.financialDate ?? {}), gte: parseLocalDate(fromRaw) }
      } catch {
        /* ignore invalid date */
      }
    }
    if (toRaw) {
      try {
        where.financialDate = { ...(where.financialDate ?? {}), lte: parseLocalDate(toRaw) }
      } catch {
        /* ignore invalid date */
      }
    }
    if (search) {
      where.comment = { contains: search }
    }

    const [total, items] = await Promise.all([
      db.walletLedgerEntry.count({ where }),
      db.walletLedgerEntry.findMany({
        where,
        orderBy: [{ financialDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return ok(serialize({ items, total, page, pageSize }))
  })(req)
}
