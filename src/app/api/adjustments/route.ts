import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { appendLedgerEntry, getWalletBalance } from '@/lib/ledger'
import { audit } from '@/lib/audit'
import { parseLocalDate, gteMoney, toCents, fromCents } from '@/lib/money'

const AdjustmentSchema = z.object({
  walletId: z.string().min(1, 'Wallet is required.'),
  actualBalance: z
    .string()
    .refine((v) => !isNaN(Number(v)), 'Actual balance must be a number.')
    .optional(),
  adjustment: z
    .string()
    .refine((v) => !isNaN(Number(v)), 'Adjustment must be a number.')
    .optional(),
  financialDate: z.string().min(1, 'Financial date is required.'),
  reason: z.string().trim().min(3, 'A reason is required (min 3 characters).').max(280),
})

/** POST /api/adjustments — create a manual wallet adjustment. */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = AdjustmentSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const { walletId, actualBalance, adjustment, financialDate, reason } = parsed.data

    if (!actualBalance && adjustment === undefined) {
      return fail('Either actualBalance or adjustment must be provided.', 400)
    }

    let result: Awaited<ReturnType<typeof createAdjustment>> | null = null
    try {
      result = await createAdjustment({
        userId,
        walletId,
        actualBalance,
        adjustment,
        financialDate,
        reason,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Adjustment failed.'
      return fail(message, 400)
    }

    await audit({
      userId,
      entityType: 'WalletAdjustment',
      entityId: result.adjustment.id,
      operation: 'create',
      newValues: serialize(result.adjustment),
      reason,
    })

    return ok(serialize({ adjustment: result.adjustment, newBalance: result.newBalance }), 201)
  })(req)
}

interface CreateAdjustmentInput {
  userId: string
  walletId: string
  actualBalance?: string
  adjustment?: string
  financialDate: string
  reason: string
}

async function createAdjustment(input: CreateAdjustmentInput) {
  return db.$transaction(async (tx) => {
    const wallet = await tx.wallet.findFirst({
      where: { id: input.walletId, userId: input.userId },
    })
    if (!wallet) throw new Error('Wallet not found.')

    const systemBalance = await getWalletBalance(wallet.id)

    let signedAdjustment: string
    if (input.adjustment !== undefined) {
      signedAdjustment = input.adjustment
    } else if (input.actualBalance !== undefined) {
      signedAdjustment = fromCents(
        toCents(input.actualBalance) - toCents(systemBalance)
      )
    } else {
      throw new Error('Either actualBalance or adjustment must be provided.')
    }

    // Zero adjustments are a no-op but still allowed for audit.
    const direction: 'credit' | 'debit' = gteMoney(signedAdjustment, '0.00') ? 'credit' : 'debit'

    const adjustment = await tx.walletAdjustment.create({
      data: {
        userId: input.userId,
        walletId: wallet.id,
        adjustment: signedAdjustment,
        actualBalance: input.actualBalance ?? null,
        systemBalance,
        financialDate: parseLocalDate(input.financialDate),
        reason: input.reason,
      },
    })

    await appendLedgerEntry(tx, {
      walletId: wallet.id,
      userId: input.userId,
      amount: signedAdjustment, // signed: positive credit, negative debit
      operationType: 'adjustment',
      direction,
      referenceType: 'adjustment',
      referenceId: adjustment.id,
      financialDate: parseLocalDate(input.financialDate),
      comment: input.reason,
    })

    const newBalance = await getWalletBalance(wallet.id)
    return { adjustment, newBalance }
  })
}
