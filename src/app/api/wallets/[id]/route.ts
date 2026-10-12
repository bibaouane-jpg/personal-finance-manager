import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { getWalletBalance } from '@/lib/ledger'
import { audit } from '@/lib/audit'

const WalletType = z.enum(['bank', 'cash', 'savings', 'other'])

const UpdateWalletSchema = z.object({
  name: z.string().trim().min(1, 'Wallet name is required.').max(80, 'Name is too long.').optional(),
  type: WalletType.optional(),
  color: z.string().max(20).optional(),
  description: z.string().max(280).nullable().optional(),
  active: z.boolean().optional(),
  allowOverdraft: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/wallets/[id] — return a wallet with its current balance and recent ledger entries. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const wallet = await db.wallet.findFirst({ where: { id, userId } })
    if (!wallet) {
      return fail('Wallet not found.', 404)
    }
    const balance = await getWalletBalance(wallet.id)
    const recentEntries = await db.walletLedgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: [{ financialDate: 'desc' }, { createdAt: 'desc' }],
      take: 10,
    })
    return ok(serialize({ ...wallet, balance, recentEntries }))
  })(req)
}

/** PUT /api/wallets/[id] — update a wallet's metadata (never initialBalance). */
export async function PUT(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.wallet.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail('Wallet not found.', 404)
    }
    const parsed = UpdateWalletSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data
    if (data.name !== undefined && data.name.trim() === '') {
      return fail('Wallet name cannot be empty.', 400)
    }

    const updated = await db.wallet.update({
      where: { id },
      data,
    })

    await audit({
      userId,
      entityType: 'Wallet',
      entityId: id,
      operation: 'update',
      previousValues: serialize(existing),
      newValues: serialize(updated),
      reason: 'Wallet updated',
    })

    return ok(serialize(updated))
  })(req)
}

/** DELETE /api/wallets/[id] — delete a wallet only if it has no ledger entries. */
export async function DELETE(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const wallet = await db.wallet.findFirst({ where: { id, userId } })
    if (!wallet) {
      return fail('Wallet not found.', 404)
    }
    const entryCount = await db.walletLedgerEntry.count({ where: { walletId: id } })
    if (entryCount > 0) {
      return fail('Cannot delete a wallet with existing transactions. Archive it instead.', 400)
    }

    await db.wallet.delete({ where: { id } })

    await audit({
      userId,
      entityType: 'Wallet',
      entityId: id,
      operation: 'delete',
      previousValues: serialize(wallet),
      reason: `Wallet deleted: ${wallet.name}`,
    })

    return ok(serialize({ ok: true }))
  })(req)
}
