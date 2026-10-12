import { db } from './db'
import { addMoney, fromCents, toCents, subMoney, gteMoney, isPositiveMoney } from './money'

/**
 * Wallet ledger service.
 *
 * Authoritative wallet balances are derived from:
 *   current = initialBalance + sum(ledgerEntries.amount)
 *
 * All mutations of the ledger happen inside Prisma transactions so that
 * the source-of-truth is never in an inconsistent state. Transfers create
 * two linked ledger entries atomically.
 */

export async function getWalletBalance(walletId: string): Promise<string> {
  const wallet = await db.wallet.findUnique({ where: { id: walletId } })
  if (!wallet) return '0.00'
  const entries = await db.walletLedgerEntry.findMany({
    where: { walletId },
    select: { amount: true },
  })
  let sum = toCents(wallet.initialBalance)
  for (const e of entries) sum += toCents(e.amount)
  return fromCents(sum)
}

export async function getWalletBalanceAt(walletId: string, upTo: Date): Promise<string> {
  const wallet = await db.wallet.findUnique({ where: { id: walletId } })
  if (!wallet) return '0.00'
  const entries = await db.walletLedgerEntry.findMany({
    where: { walletId, financialDate: { lte: upTo } },
    select: { amount: true },
  })
  let sum = toCents(wallet.initialBalance)
  for (const e of entries) sum += toCents(e.amount)
  return fromCents(sum)
}

export interface CreateLedgerInput {
  walletId: string
  userId: string
  amount: string // signed: +credit, -debit
  operationType: string
  direction: 'credit' | 'debit'
  referenceType?: string
  referenceId?: string
  financialDate: Date
  comment?: string
}

export async function appendLedgerEntry(tx: typeof db, input: CreateLedgerInput) {
  const amount = input.amount
  const entry = await tx.walletLedgerEntry.create({
    data: {
      userId: input.userId,
      walletId: input.walletId,
      amount,
      operationType: input.operationType,
      direction: input.direction,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      financialDate: input.financialDate,
      comment: input.comment,
    },
  })
  return entry
}

/** Reject a debit if it would push the wallet below 0 and overdraft is disabled. */
export async function assertDebitAllowed(
  tx: typeof db,
  walletId: string,
  debitAmount: string
): Promise<void> {
  if (!isPositiveMoney(debitAmount)) {
    throw new Error('Amount must be greater than zero.')
  }
  const wallet = await tx.wallet.findUnique({ where: { id: walletId } })
  if (!wallet) throw new Error('Wallet not found.')
  const entries = await tx.walletLedgerEntry.findMany({ where: { walletId }, select: { amount: true } })
  let sum = toCents(wallet.initialBalance)
  for (const e of entries) sum += toCents(e.amount)
  const newBalance = fromCents(sum - toCents(debitAmount))
  if (!wallet.allowOverdraft && !gteMoney(newBalance, '0.00')) {
    throw new Error('Insufficient funds in this wallet. Enable overdraft to allow negative balances.')
  }
}

export { addMoney, subMoney, toCents, fromCents, gteMoney }
