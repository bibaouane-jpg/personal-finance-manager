import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'
import { parseLocalDate, isPositiveMoney, toCents } from '@/lib/money'
import { computeLoanSummary } from '@/lib/credit-summary'

const OperationType = z.enum(['disbursement', 'repayment', 'additional', 'correction'])

const CreateOperationSchema = z.object({
  operationType: OperationType,
  amount: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid amount.'),
  operationDate: z.string().min(1, 'Operation date is required.'),
  comment: z.string().max(280).nullable().optional(),
  walletId: z.string().min(1).nullable().optional(),
  linkedExpenseId: z.string().min(1).nullable().optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/personal-loans/[id]/operations — list operations. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const loan = await db.personalLoan.findFirst({ where: { id, userId } })
    if (!loan) {
      return fail('Personal loan not found.', 404)
    }
    const operations = await db.personalLoanOperation.findMany({
      where: { personalLoanId: id },
      orderBy: { operationDate: 'asc' },
    })
    return ok(serialize({ items: operations }))
  })(req)
}

/** POST /api/personal-loans/[id]/operations — record an operation. */
export async function POST(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const loan = await db.personalLoan.findFirst({ where: { id, userId } })
    if (!loan) {
      return fail('Personal loan not found.', 404)
    }

    const parsed = CreateOperationSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    // 'correction' requires a comment.
    if (data.operationType === 'correction') {
      if (!data.comment || data.comment.trim() === '') {
        return fail('A comment is required for correction operations.', 400)
      }
    }

    // For 'repayment': ensure amount does not exceed outstanding.
    if (data.operationType === 'repayment') {
      if (!isPositiveMoney(data.amount)) {
        return fail('Repayment amount must be greater than zero.', 400)
      }
      const summary = await computeLoanSummary(loan)
      if (toCents(data.amount) > toCents(summary.outstanding)) {
        return fail('Repayment exceeds the outstanding amount.', 400)
      }
    }

    if (
      data.operationType === 'disbursement' ||
      data.operationType === 'additional'
    ) {
      if (!isPositiveMoney(data.amount)) {
        return fail('Disbursement amount must be greater than zero.', 400)
      }
    }

    if (data.operationType === 'correction') {
      // Allow zero or non-zero for corrections (signed amount).
      const n = Number(data.amount)
      if (!Number.isFinite(n)) {
        return fail('Invalid correction amount.', 400)
      }
    }

    const operationDate = parseLocalDate(data.operationDate)

    const operation = await db.personalLoanOperation.create({
      data: {
        userId,
        personalLoanId: id,
        operationType: data.operationType,
        amount: data.amount,
        operationDate,
        comment: data.comment ?? null,
        walletId:
          data.walletId === undefined ? undefined : (data.walletId ?? null),
        linkedExpenseId:
          data.linkedExpenseId === undefined
            ? undefined
            : (data.linkedExpenseId ?? null),
      },
    })

    // Re-fetch the loan with operations for the summary.
    const updatedLoan = await db.personalLoan.findFirst({
      where: { id },
      include: { operations: { orderBy: { operationDate: 'asc' } } },
    })
    const summary = await computeLoanSummary(updatedLoan as any)

    await audit({
      userId,
      entityType: 'PersonalLoanOperation',
      entityId: operation.id,
      operation: 'create',
      newValues: serialize(operation),
      reason: `${data.operationType} operation on loan ${loan.borrowerName}: ${data.amount}`,
    })

    return ok(serialize({ operation, loan: { ...updatedLoan, ...summary } }), 201)
  })(req)
}
