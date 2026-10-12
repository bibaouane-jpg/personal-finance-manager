import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { getWalletBalance } from '@/lib/ledger'
import { audit } from '@/lib/audit'
import { addMoney, toCents, fromCents } from '@/lib/money'

const WalletType = z.enum(['bank', 'cash', 'savings', 'other'])

const CreateWalletSchema = z.object({
  name: z.string().trim().min(1, 'Wallet name is required.').max(80, 'Name is too long.'),
  type: WalletType,
  color: z.string().max(20).optional(),
  description: z.string().max(280).optional(),
  initialBalance: z
    .string()
    .refine((v) => !isNaN(Number(v)), 'Initial balance must be a number.')
    .default('0'),
  allowOverdraft: z.boolean().optional(),
  active: z.boolean().optional(),
})

/** GET /api/wallets — list the user's wallets with current balances and subtotals. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const wallets = await db.wallet.findMany({
      where: { userId },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    })

    const enriched = await Promise.all(
      wallets.map(async (w) => {
        const balance = await getWalletBalance(w.id)
        return { ...w, balance }
      })
    )

    const combined = enriched.reduce((acc, w) => addMoney(acc, w.balance), '0.00')

    const subtotal = (type: string) =>
      enriched
        .filter((w) => w.type === type)
        .reduce((acc, w) => addMoney(acc, w.balance), '0.00')

    const bankSubtotal = subtotal('bank')
    const cashSubtotal = subtotal('cash')
    const savingsSubtotal = subtotal('savings')
    const otherSubtotal = subtotal('other')

    return ok(
      serialize({
        wallets: enriched,
        combined,
        bankSubtotal,
        cashSubtotal,
        savingsSubtotal,
        otherSubtotal,
      })
    )
  })(req)
}

/** POST /api/wallets — create a new wallet. */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = CreateWalletSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    const wallet = await db.wallet.create({
      data: {
        userId,
        name: data.name,
        type: data.type,
        color: data.color ?? '#2563eb',
        description: data.description ?? null,
        initialBalance: data.initialBalance,
        allowOverdraft: data.allowOverdraft ?? false,
        active: data.active ?? true,
      },
    })

    await audit({
      userId,
      entityType: 'Wallet',
      entityId: wallet.id,
      operation: 'create',
      newValues: serialize(wallet),
      reason: `Wallet created: ${wallet.name}`,
    })

    return ok(serialize({ ...wallet, balance: fromCents(toCents(wallet.initialBalance)) }), 201)
  })(req)
}
