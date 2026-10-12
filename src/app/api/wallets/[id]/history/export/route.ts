import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth, fail } from '@/lib/api'
import { audit } from '@/lib/audit'
import { parseLocalDate } from '@/lib/money'

function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  let v = String(value)
  // Formula-injection guard.
  if (/^[=+\-@]/.test(v)) {
    v = `'${v}`
  }
  // Wrap in quotes and escape embedded quotes/newlines/commas.
  if (/[",\n\r]/.test(v)) {
    v = `"${v.replace(/"/g, '""')}"`
  }
  return v
}

type Params = { params: Promise<{ id: string }> }

/** GET /api/wallets/[id]/history/export — export all ledger entries for the wallet as CSV. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const wallet = await db.wallet.findFirst({ where: { id, userId } })
    if (!wallet) {
      return fail('Wallet not found.', 404)
    }

    const url = new URL(req.url)
    const fromRaw = url.searchParams.get('from')
    const toRaw = url.searchParams.get('to')
    const search = url.searchParams.get('search')?.trim() || ''

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
        const endDate = parseLocalDate(toRaw)
        endDate.setUTCHours(23, 59, 59, 999)
        where.financialDate = { ...(where.financialDate ?? {}), lte: endDate }
      } catch {
        /* ignore invalid date */
      }
    }
    if (search) {
      where.comment = { contains: search }
    }

    const entries = await db.walletLedgerEntry.findMany({
      where,
      orderBy: [{ financialDate: 'asc' }, { createdAt: 'asc' }],
    })

    const header = ['Date', 'OperationType', 'Direction', 'Amount', 'Comment']
    const rows = entries.map((e) => {
      const d =
        e.financialDate instanceof Date ? e.financialDate : new Date(e.financialDate)
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
      return [
        escapeCsvCell(dateStr),
        escapeCsvCell(e.operationType),
        escapeCsvCell(e.direction),
        escapeCsvCell(e.amount),
        escapeCsvCell(e.comment ?? ''),
      ].join(',')
    })

    const csv = [header.join(','), ...rows].join('\r\n')

    await audit({
      userId,
      entityType: 'WalletLedgerEntry',
      entityId: `export:${id}`,
      operation: 'update',
      newValues: { count: entries.length, walletId: id, walletName: wallet.name },
      reason: `Exported ${entries.length} ledger entries for wallet "${wallet.name}" to CSV`,
    })

    const safeWalletName = wallet.name.replace(/[^a-z0-9\-_]+/gi, '_').slice(0, 40) || 'wallet'

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="wallet-${safeWalletName}-history.csv"`,
      },
    })
  })(req)
}
