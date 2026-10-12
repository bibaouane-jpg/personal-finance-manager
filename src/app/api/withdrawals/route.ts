import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { appendLedgerEntry, assertDebitAllowed, getWalletBalance } from '@/lib/ledger'
import { audit } from '@/lib/audit'
import { parseLocalDate, subMoney, isPositiveMoney } from '@/lib/money'

const WithdrawalSchema = z.object({
  sourceWalletId: z.string().min(1, 'Source wallet is required.'),
  destWalletId: z.string().optional(),
  withdrawalType: z.enum(['external', 'internal']),
  amount: z
    .string()
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, 'Amount must be greater than zero.'),
  financialDate: z.string().min(1, 'Financial date is required.'),
  comment: z.string().max(280).optional(),
})

/** POST /api/withdrawals — withdraw cash from a wallet (external or internal). */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = WithdrawalSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const { sourceWalletId, destWalletId, withdrawalType, amount, financialDate, comment } = parsed.data

    if (withdrawalType === 'internal' && !destWalletId) {
      return fail('Destination wallet is required for internal withdrawals.', 400)
    }
    if (destWalletId && destWalletId === sourceWalletId) {
      return fail('Source and destination must be different.', 400)
    }
    if (!isPositiveMoney(amount)) {
      return fail('Amount must be greater than zero.', 400)
    }

    let result: Awaited<ReturnType<typeof createWithdrawal>> | null = null
    try {
      result = await createWithdrawal({
        userId,
        sourceWalletId,
        destWalletId,
        withdrawalType,
        amount,
        financialDate,
        comment,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Withdrawal failed.'
      return fail(message, 400)
    }

    await audit({
      userId,
      entityType: 'CashWithdrawal',
      entityId: result.withdrawal.id,
      operation: 'create',
      newValues: serialize(result.withdrawal),
      reason: `${withdrawalType} withdrawal of ${amount} from ${sourceWalletId}`,
    })

    return ok(
      serialize({
        withdrawal: result.withdrawal,
        sourceBalance: result.sourceBalance,
        destBalance: result.destBalance,
      }),
      201
    )
  })(req)
}

interface CreateWithdrawalInput {
  userId: string
  sourceWalletId: string
  destWalletId?: string
  withdrawalType: 'external' | 'internal'
  amount: string
  financialDate: string
  comment?: string
}

async function createWithdrawal(input: CreateWithdrawalInput) {
  return db.$transaction(async (tx) => {
    const source = await tx.wallet.findFirst({
      where: { id: input.sourceWalletId, userId: input.userId },
    })
    if (!source) throw new Error('Source wallet not found.')
    if (!source.active) throw new Error('Source wallet is not active.')

    let dest = null
    if (input.withdrawalType === 'internal') {
      if (!input.destWalletId) throw new Error('Destination wallet is required for internal withdrawals.')
      dest = await tx.wallet.findFirst({
        where: { id: input.destWalletId, userId: input.userId },
      })
      if (!dest) throw new Error('Destination wallet not found.')
      if (!dest.active) throw new Error('Destination wallet is not active.')
    }

    await assertDebitAllowed(tx, source.id, input.amount)

    const financialDate = parseLocalDate(input.financialDate)
    const debitAmount = subMoney('0', input.amount) // negative

    const withdrawal = await tx.cashWithdrawal.create({
      data: {
        userId: input.userId,
        sourceWalletId: source.id,
        destWalletId: dest?.id ?? null,
        withdrawalType: input.withdrawalType,
        amount: input.amount,
        financialDate,
        comment: input.comment ?? null,
      },
    })

    const sourceOpType = input.withdrawalType === 'external' ? 'withdrawal_external' : 'withdrawal_internal'

    await appendLedgerEntry(tx, {
      walletId: source.id,
      userId: input.userId,
      amount: debitAmount,
      operationType: sourceOpType,
      direction: 'debit',
      referenceType: 'withdrawal',
      referenceId: withdrawal.id,
      financialDate,
      comment: input.comment ?? undefined,
    })

    if (dest) {
      await appendLedgerEntry(tx, {
        walletId: dest.id,
        userId: input.userId,
        amount: input.amount, // positive
        operationType: 'withdrawal_internal',
        direction: 'credit',
        referenceType: 'withdrawal',
        referenceId: withdrawal.id,
        financialDate,
        comment: input.comment ?? undefined,
      })
    }

    const sourceBalance = await getWalletBalance(source.id)
    const destBalance = dest ? await getWalletBalance(dest.id) : null

    return { withdrawal, sourceBalance, destBalance }
  })
}
