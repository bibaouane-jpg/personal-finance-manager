import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'
import { parseLocalDate } from '@/lib/money'
import { computeLoanSummary } from '@/lib/credit-summary'

const UpdatePersonalLoanSchema = z.object({
  borrowerName: z
    .string()
    .trim()
    .min(1, 'Borrower name is required.')
    .max(120)
    .optional(),
  description: z.string().max(280).nullable().optional(),
  expectedRepayDate: z.string().min(1).nullable().optional(),
  comment: z.string().max(280).nullable().optional(),
  status: z.string().max(40).optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/personal-loans/[id] — one loan with operations and summary. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const loan = await db.personalLoan.findFirst({
      where: { id, userId },
      include: { operations: { orderBy: { operationDate: 'asc' } } },
    })
    if (!loan) {
      return fail('Personal loan not found.', 404)
    }
    const summary = await computeLoanSummary(loan)
    return ok(serialize({ ...loan, ...summary }))
  })(req)
}

/** PUT /api/personal-loans/[id] — update loan metadata (not the amount). */
export async function PUT(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.personalLoan.findFirst({
      where: { id, userId },
      include: { operations: true },
    })
    if (!existing) {
      return fail('Personal loan not found.', 404)
    }

    const parsed = UpdatePersonalLoanSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    const updated = await db.personalLoan.update({
      where: { id },
      data: {
        borrowerName: data.borrowerName,
        description: data.description === undefined ? undefined : (data.description ?? null),
        expectedRepayDate:
          data.expectedRepayDate === undefined
            ? undefined
            : data.expectedRepayDate === null
              ? null
              : parseLocalDate(data.expectedRepayDate),
        comment: data.comment === undefined ? undefined : (data.comment ?? null),
        status: data.status,
      },
      include: { operations: { orderBy: { operationDate: 'asc' } } },
    })

    const summary = await computeLoanSummary(updated)

    await audit({
      userId,
      entityType: 'PersonalLoan',
      entityId: id,
      operation: 'update',
      previousValues: serialize(existing),
      newValues: serialize({ ...updated, ...summary }),
      reason: `Personal loan updated: ${updated.borrowerName}`,
    })

    return ok(serialize({ ...updated, ...summary }))
  })(req)
}

/** DELETE /api/personal-loans/[id] — refuse if has operations beyond initial disbursement. */
export async function DELETE(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.personalLoan.findFirst({
      where: { id, userId },
      include: { operations: true },
    })
    if (!existing) {
      return fail('Personal loan not found.', 404)
    }

    // The initial disbursement is auto-created; allow delete only if it's the only operation.
    if (existing.operations.length > 1) {
      return fail(
        'Cannot delete a loan with operations beyond the initial disbursement. Mark it as settled instead.',
        409
      )
    }

    // Cascade delete operations explicitly (FK cascade also handles this).
    await db.$transaction(async (tx) => {
      await tx.personalLoanOperation.deleteMany({ where: { personalLoanId: id } })
      await tx.personalLoan.delete({ where: { id } })
    })

    await audit({
      userId,
      entityType: 'PersonalLoan',
      entityId: id,
      operation: 'delete',
      previousValues: serialize(existing),
      reason: `Personal loan deleted: ${existing.borrowerName}`,
    })

    return ok(serialize({ ok: true }))
  })(req)
}
