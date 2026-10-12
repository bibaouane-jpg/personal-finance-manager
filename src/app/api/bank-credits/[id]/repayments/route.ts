import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'
import { parseLocalDate, isPositiveMoney, toCents, fromCents } from '@/lib/money'
import { computeCreditSummary } from '@/lib/credit-summary'

const CreateRepaymentSchema = z.object({
  amount: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid amount.'),
  paymentDate: z.string().min(1, 'Payment date is required.'),
  comment: z.string().max(280).nullable().optional(),
  walletId: z.string().min(1).nullable().optional(),
  linkedExpenseId: z.string().min(1).nullable().optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/bank-credits/[id]/repayments — list repayments for a credit. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const credit = await db.bankCredit.findFirst({ where: { id, userId } })
    if (!credit) {
      return fail('Bank credit not found.', 404)
    }
    const repayments = await db.creditRepayment.findMany({
      where: { bankCreditId: id },
      orderBy: { paymentDate: 'desc' },
    })
    return ok(serialize({ items: repayments }))
  })(req)
}

/** POST /api/bank-credits/[id]/repayments — record a repayment and auto-mark installments. */
export async function POST(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const credit = await db.bankCredit.findFirst({ where: { id, userId } })
    if (!credit) {
      return fail('Bank credit not found.', 404)
    }

    const parsed = CreateRepaymentSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    if (!isPositiveMoney(data.amount)) {
      return fail('Repayment amount must be greater than zero.', 400)
    }

    const paymentDate = parseLocalDate(data.paymentDate)

    // Create the repayment, then mark earliest pending installments as paid.
    const repayment = await db.$transaction(async (tx) => {
      const rep = await tx.creditRepayment.create({
        data: {
          userId,
          bankCreditId: id,
          amount: data.amount,
          paymentDate,
          comment: data.comment ?? null,
          walletId:
            data.walletId === undefined ? undefined : (data.walletId ?? null),
          linkedExpenseId:
            data.linkedExpenseId === undefined
              ? undefined
              : (data.linkedExpenseId ?? null),
        },
      })

      // Mark earliest pending installments whose cumulative amount <= repayment.
      let remainingCents = toCents(data.amount)
      const pendingInstallments = await tx.creditInstallment.findMany({
        where: { bankCreditId: id, status: 'pending' },
        orderBy: { installmentNumber: 'asc' },
      })
      for (const inst of pendingInstallments) {
        if (remainingCents <= 0) break
        const instCents = toCents(inst.amount)
        if (instCents <= remainingCents) {
          await tx.creditInstallment.update({
            where: { id: inst.id },
            data: { status: 'paid' },
          })
          remainingCents -= instCents
        } else {
          // Partial payment: stop here; do not mark as paid.
          break
        }
      }

      return rep
    })

    // Re-fetch the credit with full relations for the summary.
    const updatedCredit = await db.bankCredit.findFirst({
      where: { id },
      include: {
        installments: { orderBy: { installmentNumber: 'asc' } },
        repayments: { orderBy: { paymentDate: 'desc' } },
        allocations: true,
      },
    })
    const summary = await computeCreditSummary(updatedCredit as any)

    await audit({
      userId,
      entityType: 'CreditRepayment',
      entityId: repayment.id,
      operation: 'create',
      newValues: serialize(repayment),
      reason: `Repayment recorded for credit ${credit.creditName}: ${data.amount}`,
    })

    return ok(serialize({ repayment, credit: { ...updatedCredit, ...summary } }), 201)
  })(req)
}
