import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getWalletBalance } from '@/lib/ledger'

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

/** GET /api/wallets/export — export all wallets (with current balances) as CSV. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const wallets = await db.wallet.findMany({
      where: { userId },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    })

    const enriched = await Promise.all(
      wallets.map(async (w) => ({
        wallet: w,
        balance: await getWalletBalance(w.id),
      }))
    )

    const header = [
      'Name',
      'Type',
      'InitialBalance',
      'CurrentBalance',
      'Active',
      'Description',
    ]
    const rows = enriched.map((e) =>
      [
        escapeCsvCell(e.wallet.name),
        escapeCsvCell(e.wallet.type),
        escapeCsvCell(e.wallet.initialBalance),
        escapeCsvCell(e.balance),
        escapeCsvCell(e.wallet.active ? 'true' : 'false'),
        escapeCsvCell(e.wallet.description ?? ''),
      ].join(',')
    )

    const csv = [header.join(','), ...rows].join('\r\n')

    await audit({
      userId,
      entityType: 'Wallet',
      entityId: 'export',
      operation: 'update',
      newValues: { count: wallets.length },
      reason: `Exported ${wallets.length} wallets to CSV`,
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="wallets.csv"',
      },
    })
  })(req)
}
