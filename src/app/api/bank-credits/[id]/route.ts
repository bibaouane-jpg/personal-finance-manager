import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'
import { parseLocalDate } from '@/lib/money'
import { computeCreditSummary } from '@/lib/credit-summary'

const UpdateBankCreditSchema = z.object({
  creditName: z
    .string()
    .trim()
    .min(1, 'Credit name is required.')
    .max(120)
    .optional(),
  lender: z.string().trim().min(1).max(120).optional(),
  originalPrincipal: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid principal amount.')
    .optional(),
  durationMonths: z
    .number()
    .int()
    .min(1)
    .max(600)
    .optional(),
  startDate: z.string().min(1).optional(),
  monthlyInstallment: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid monthly installment.')
    .optional(),
  interestRate: z
    .string()
    .refine((v) => v === '' || !isNaN(Number(v)), 'Invalid interest rate.')
    .nullable()
    .optional(),
  fees: z
    .string()
    .refine((v) => v === '' || !isNaN(Number(v)), 'Invalid fees.')
    .nullable()
    .optional(),
  paymentDay: z.number().int().min(1).max(31).optional(),
  description: z.string().max(280).nullable().optional(),
  status: z.string().max(40).optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/bank-credits/[id] — one credit with installments, repayments, allocations, summary. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const credit = await db.bankCredit.findFirst({
      where: { id, userId },
      include: {
        installments: { orderBy: { installmentNumber: 'asc' } },
        repayments: { orderBy: { paymentDate: 'desc' } },
        allocations: true,
      },
    })
    if (!credit) {
      return fail('Bank credit not found.', 404)
    }
    const summary = await computeCreditSummary(credit)
    return ok(serialize({ ...credit, ...summary }))
  })(req)
}

/** PUT /api/bank-credits/[id] — update editable fields; regenerate installment schedule when needed. */
export async function PUT(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.bankCredit.findFirst({
      where: { id, userId },
      include: { installments: true },
    })
    if (!existing) {
      return fail('Bank credit not found.', 404)
    }

    const parsed = UpdateBankCreditSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    const newDuration = data.durationMonths ?? existing.durationMonths
    const newStart = data.startDate ? parseLocalDate(data.startDate) : existing.startDate
    const newInstallment = data.monthlyInstallment ?? existing.monthlyInstallment

    // Regenerate the schedule only if the schedule-affecting fields changed.
    const scheduleChanged =
      (data.durationMonths !== undefined && data.durationMonths !== existing.durationMonths) ||
      (data.startDate !== undefined &&
        parseLocalDate(data.startDate).getTime() !== existing.startDate.getTime()) ||
      (data.monthlyInstallment !== undefined &&
        data.monthlyInstallment !== existing.monthlyInstallment)

    const updated = await db.$transaction(async (tx) => {
      if (scheduleChanged) {
        // Delete installments that are still pending (keep 'paid' ones).
        await tx.creditInstallment.deleteMany({
          where: { bankCreditId: id, status: 'pending' },
        })

        // Recreate the full schedule from start.
        const start = newStart instanceof Date ? newStart : new Date(newStart as string)
        for (let i = 0; i < newDuration; i++) {
          const due = new Date(
            start.getFullYear(),
            start.getMonth() + i,
            start.getDate()
          )
          // Skip creating a pending installment if one is already paid for
          // the same installment number (avoid duplicates).
          const alreadyPaid = await tx.creditInstallment.findFirst({
            where: { bankCreditId: id, installmentNumber: i + 1, status: 'paid' },
          })
          if (alreadyPaid) continue

          await tx.creditInstallment.create({
            data: {
              bankCreditId: id,
              installmentNumber: i + 1,
              dueDate: due,
              amount: newInstallment,
              status: 'pending',
            },
          })
        }
      }

      return tx.bankCredit.update({
        where: { id },
        data: {
          creditName: data.creditName,
          lender: data.lender,
          originalPrincipal: data.originalPrincipal,
          durationMonths: data.durationMonths,
          startDate: data.startDate ? newStart : undefined,
          monthlyInstallment: data.monthlyInstallment,
          interestRate:
            data.interestRate === undefined
              ? undefined
              : data.interestRate === null || data.interestRate === ''
                ? null
                : data.interestRate,
          fees:
            data.fees === undefined
              ? undefined
              : data.fees === null || data.fees === ''
                ? null
                : data.fees,
          paymentDay: data.paymentDay,
          description: data.description === undefined ? undefined : (data.description ?? null),
          status: data.status,
        },
        include: {
          installments: { orderBy: { installmentNumber: 'asc' } },
          repayments: { orderBy: { paymentDate: 'desc' } },
          allocations: true,
        },
      })
    })

    const summary = await computeCreditSummary(updated)

    await audit({
      userId,
      entityType: 'BankCredit',
      entityId: id,
      operation: 'update',
      previousValues: serialize(existing),
      newValues: serialize({ ...updated, ...summary }),
      reason: `Bank credit updated: ${updated.creditName}${scheduleChanged ? ' (schedule regenerated)' : ''}`,
    })

    return ok(serialize({ ...updated, ...summary }))
  })(req)
}

/** DELETE /api/bank-credits/[id] — refuse if any repayments recorded. */
export async function DELETE(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.bankCredit.findFirst({
      where: { id, userId },
      include: { repayments: { select: { id: true } } },
    })
    if (!existing) {
      return fail('Bank credit not found.', 404)
    }

    if (existing.repayments.length > 0) {
      return fail(
        'Cannot delete a credit with repayments. Mark it as completed instead.',
        409
      )
    }

    // Cascade delete installments (explicit because there's no other relation).
    await db.$transaction(async (tx) => {
      await tx.creditInstallment.deleteMany({ where: { bankCreditId: id } })
      await tx.bankCredit.delete({ where: { id } })
    })

    await audit({
      userId,
      entityType: 'BankCredit',
      entityId: id,
      operation: 'delete',
      previousValues: serialize(existing),
      reason: `Bank credit deleted: ${existing.creditName}`,
    })

    return ok(serialize({ ok: true }))
  })(req)
}
