import { db } from './db'
import { pct, fromCents, toCents, subMoney } from './money'

/** Compute allocation progress.
 *  If linked to a bank credit, derive from credit repayments / originalPrincipal.
 *  Otherwise use the stored manual progress value.
 */
export async function computeAllocationProgress(allocation: {
  bankCreditId: string | null
  progress: number
}): Promise<number> {
  if (allocation.bankCreditId) {
    const credit = await db.bankCredit.findUnique({
      where: { id: allocation.bankCreditId },
      select: { originalPrincipal: true, repayments: { select: { amount: true } } },
    })
    if (credit) {
      const totalRepaid = credit.repayments.reduce(
        (sum, r) => sum + toCents(r.amount),
        0
      )
      const p = pct(fromCents(totalRepaid), credit.originalPrincipal)
      return Math.max(0, Math.min(100, Math.round(p)))
    }
  }
  return allocation.progress
}

/** Compute summary fields for a bank credit. */
export async function computeCreditSummary(credit: {
  id: string
  originalPrincipal: string
  durationMonths: number
  startDate: Date | string
  monthlyInstallment: string
  repayments?: { amount: string }[]
}) {
  const repayments =
    credit.repayments ??
    (await db.creditRepayment.findMany({
      where: { bankCreditId: credit.id },
      select: { amount: true },
    }))

  const totalRepaidCents = repayments.reduce(
    (sum, r) => sum + toCents(r.amount),
    0
  )
  const principalCents = toCents(credit.originalPrincipal)
  const outstandingCents = Math.max(0, principalCents - totalRepaidCents)
  const progressPct = Math.max(0, Math.min(100, Math.round(pct(fromCents(totalRepaidCents), credit.originalPrincipal))))

  const start = credit.startDate instanceof Date
    ? credit.startDate
    : new Date(credit.startDate)
  const expectedEndDate = new Date(
    start.getFullYear(),
    start.getMonth() + credit.durationMonths,
    start.getDate()
  )

  // Earliest unpaid installment dueDate strictly after today.
  const installments = await db.creditInstallment.findMany({
    where: { bankCreditId: credit.id, status: 'pending' },
    orderBy: { dueDate: 'asc' },
    select: { dueDate: true },
  })
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let nextDueDate: Date | null = null
  for (const ins of installments) {
    const due = ins.dueDate instanceof Date ? ins.dueDate : new Date(ins.dueDate)
    if (due >= today) {
      nextDueDate = due
      break
    }
  }

  const paidInstallments = await db.creditInstallment.count({
    where: { bankCreditId: credit.id, status: 'paid' },
  })
  const totalInstallments = await db.creditInstallment.count({
    where: { bankCreditId: credit.id },
  })

  return {
    totalRepaid: fromCents(totalRepaidCents),
    outstanding: fromCents(outstandingCents),
    paidInstallments,
    remainingInstallments: Math.max(0, totalInstallments - paidInstallments),
    progressPct,
    nextDueDate,
    expectedEndDate,
  }
}

/** Compute summary fields for a personal loan. */
export async function computeLoanSummary(loan: {
  id: string
  operations?: {
    operationType: string
    amount: string
  }[]
}) {
  const operations =
    loan.operations ??
    (await db.personalLoanOperation.findMany({
      where: { personalLoanId: loan.id },
      select: { operationType: true, amount: true },
    }))

  let totalLent = 0
  let totalRepaid = 0
  for (const op of operations) {
    const cents = toCents(op.amount)
    if (op.operationType === 'disbursement' || op.operationType === 'additional') {
      totalLent += cents
    } else if (op.operationType === 'repayment') {
      totalRepaid += cents
    } else if (op.operationType === 'correction') {
      // A correction is a signed adjustment. Positive adds to lent,
      // negative reduces it. (Stored as signed cents.)
      totalLent += cents
    }
  }

  const outstandingCents = Math.max(0, totalLent - totalRepaid)
  const progressPct = Math.max(
    0,
    Math.min(100, Math.round(pct(fromCents(totalRepaid), fromCents(totalLent))))
  )

  return {
    totalLent: fromCents(totalLent),
    totalRepaid: fromCents(totalRepaid),
    outstanding: fromCents(outstandingCents),
    progressPct,
  }
}

export { pct, fromCents, toCents, subMoney }
