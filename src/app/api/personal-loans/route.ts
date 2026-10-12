import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'
import { parseLocalDate, isPositiveMoney } from '@/lib/money'
import { computeLoanSummary } from '@/lib/credit-summary'

const CreatePersonalLoanSchema = z.object({
  borrowerName: z
    .string()
    .trim()
    .min(1, 'Borrower name is required.')
    .max(120, 'Borrower name is too long (max 120 chars).'),
  description: z.string().max(280).nullable().optional(),
  originalAmount: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid amount.'),
  loanDate: z.string().min(1, 'Loan date is required.'),
  expectedRepayDate: z.string().min(1).nullable().optional(),
  comment: z.string().max(280).nullable().optional(),
  status: z.string().max(40).optional(),
})

/** GET /api/personal-loans — list loans with operations and computed summary. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const loans = await db.personalLoan.findMany({
      where: { userId },
      include: {
        operations: { orderBy: { operationDate: 'asc' } },
      },
      orderBy: [{ createdAt: 'desc' }],
    })

    const items = []
    for (const l of loans) {
      const summary = await computeLoanSummary(l)
      items.push(serialize({ ...l, ...summary }))
    }

    return ok(serialize({ items }))
  })(req)
}

/** POST /api/personal-loans — create a loan and an initial disbursement operation. */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = CreatePersonalLoanSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    if (!isPositiveMoney(data.originalAmount)) {
      return fail('Original loan amount must be greater than zero.', 400)
    }

    const loanDate = parseLocalDate(data.loanDate)
    const expectedRepayDate =
      data.expectedRepayDate === undefined
        ? undefined
        : data.expectedRepayDate === null
          ? null
          : parseLocalDate(data.expectedRepayDate)

    const created = await db.$transaction(async (tx) => {
      const loan = await tx.personalLoan.create({
        data: {
          userId,
          borrowerName: data.borrowerName,
          description: data.description ?? null,
          originalAmount: data.originalAmount,
          loanDate,
          expectedRepayDate: expectedRepayDate ?? null,
          comment: data.comment ?? null,
          status: data.status ?? 'active',
        },
        include: { operations: true },
      })

      // Initial disbursement operation.
      const disbursement = await tx.personalLoanOperation.create({
        data: {
          userId,
          personalLoanId: loan.id,
          operationType: 'disbursement',
          amount: data.originalAmount,
          operationDate: loanDate,
          comment: 'Initial disbursement',
        },
      })

      return { ...loan, operations: [disbursement] }
    })

    const summary = await computeLoanSummary(created)

    await audit({
      userId,
      entityType: 'PersonalLoan',
      entityId: created.id,
      operation: 'create',
      newValues: serialize({ ...created, ...summary }),
      reason: `Personal loan created: ${created.borrowerName}`,
    })

    return ok(serialize({ ...created, ...summary }), 201)
  })(req)
}
