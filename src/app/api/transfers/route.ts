import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { appendLedgerEntry, assertDebitAllowed, getWalletBalance } from '@/lib/ledger'
import { audit } from '@/lib/audit'
import { parseLocalDate, subMoney, isPositiveMoney } from '@/lib/money'

const TransferSchema = z.object({
  sourceWalletId: z.string().min(1, 'Source wallet is required.'),
  destWalletId: z.string().min(1, 'Destination wallet is required.'),
  amount: z
    .string()
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, 'Amount must be greater than zero.'),
  financialDate: z.string().min(1, 'Financial date is required.'),
  comment: z.string().max(280).optional(),
})

/** POST /api/transfers — atomic transfer between two wallets. */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = TransferSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const { sourceWalletId, destWalletId, amount, financialDate, comment } = parsed.data

    if (sourceWalletId === destWalletId) {
      return fail('Source and destination must be different.', 400)
    }
    if (!isPositiveMoney(amount)) {
      return fail('Amount must be greater than zero.', 400)
    }

    let transferResult: Awaited<ReturnType<typeof createTransfer>> | null = null
    try {
      transferResult = await createTransfer({
        userId,
        sourceWalletId,
        destWalletId,
        amount,
        financialDate,
        comment,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Transfer failed.'
      return fail(message, 400)
    }

    await audit({
      userId,
      entityType: 'WalletTransfer',
      entityId: transferResult.transfer.id,
      operation: 'create',
      newValues: serialize(transferResult.transfer),
      reason: `Transfer of ${amount} from ${sourceWalletId} to ${destWalletId}`,
    })

    return ok(
      serialize({
        transfer: transferResult.transfer,
        sourceBalance: transferResult.sourceBalance,
        destBalance: transferResult.destBalance,
      }),
      201
    )
  })(req)
}

interface CreateTransferInput {
  userId: string
  sourceWalletId: string
  destWalletId: string
  amount: string
  financialDate: string
  comment?: string
}

async function createTransfer(input: CreateTransferInput) {
  return db.$transaction(async (tx) => {
    const source = await tx.wallet.findFirst({
      where: { id: input.sourceWalletId, userId: input.userId },
    })
    const dest = await tx.wallet.findFirst({
      where: { id: input.destWalletId, userId: input.userId },
    })
    if (!source) throw new Error('Source wallet not found.')
    if (!dest) throw new Error('Destination wallet not found.')
    if (!source.active) throw new Error('Source wallet is not active.')
    if (!dest.active) throw new Error('Destination wallet is not active.')

    await assertDebitAllowed(tx, source.id, input.amount)

    const financialDate = parseLocalDate(input.financialDate)
    const debitAmount = subMoney('0', input.amount) // negative

    const transfer = await tx.walletTransfer.create({
      data: {
        userId: input.userId,
        sourceWalletId: source.id,
        destWalletId: dest.id,
        amount: input.amount,
        financialDate,
        comment: input.comment ?? null,
      },
    })

    await appendLedgerEntry(tx, {
      walletId: source.id,
      userId: input.userId,
      amount: debitAmount,
      operationType: 'transfer_out',
      direction: 'debit',
      referenceType: 'transfer',
      referenceId: transfer.id,
      financialDate,
      comment: input.comment ?? undefined,
    })

    await appendLedgerEntry(tx, {
      walletId: dest.id,
      userId: input.userId,
      amount: input.amount, // positive
      operationType: 'transfer_in',
      direction: 'credit',
      referenceType: 'transfer',
      referenceId: transfer.id,
      financialDate,
      comment: input.comment ?? undefined,
    })

    const [sourceBalance, destBalance] = await Promise.all([
      getWalletBalance(source.id),
      getWalletBalance(dest.id),
    ])

    return { transfer, sourceBalance, destBalance }
  })
}
