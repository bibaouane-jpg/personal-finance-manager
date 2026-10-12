import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'
import { parseLocalDate, isPositiveMoney } from '@/lib/money'
import { computeCreditSummary } from '@/lib/credit-summary'

const CreateBankCreditSchema = z.object({
  creditName: z
    .string()
    .trim()
    .min(1, 'Credit name is required.')
    .max(120, 'Credit name is too long (max 120 chars).'),
  lender: z
    .string()
    .trim()
    .min(1, 'Lender is required.')
    .max(120, 'Lender is too long (max 120 chars).'),
  originalPrincipal: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid principal amount.'),
  durationMonths: z
    .number()
    .int('Duration must be a whole number of months.')
    .min(1, 'Duration must be at least 1 month.')
    .max(600, 'Duration is too long (max 600 months).'),
  startDate: z.string().min(1, 'Start date is required.'),
  monthlyInstallment: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid monthly installment.'),
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
  paymentDay: z
    .number()
    .int()
    .min(1, 'Payment day must be between 1 and 31.')
    .max(31, 'Payment day must be between 1 and 31.'),
  description: z.string().max(280).nullable().optional(),
  status: z.string().max(40).optional(),
})

/** GET /api/bank-credits — list credits with computed summary. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const credits = await db.bankCredit.findMany({
      where: { userId },
      include: {
        repayments: { select: { amount: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    })

    const items = []
    for (const c of credits) {
      const summary = await computeCreditSummary(c)
      items.push(serialize({ ...c, ...summary }))
    }

    return ok(serialize({ items }))
  })(req)
}

/** POST /api/bank-credits — create a credit and auto-generate the installment schedule. */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = CreateBankCreditSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    if (!isPositiveMoney(data.originalPrincipal)) {
      return fail('Original principal must be greater than zero.', 400)
    }
    if (!isPositiveMoney(data.monthlyInstallment)) {
      return fail('Monthly installment must be greater than zero.', 400)
    }

    const startDate = parseLocalDate(data.startDate)

    const created = await db.$transaction(async (tx) => {
      const credit = await tx.bankCredit.create({
        data: {
          userId,
          creditName: data.creditName,
          lender: data.lender,
          originalPrincipal: data.originalPrincipal,
          durationMonths: data.durationMonths,
          startDate,
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
          description: data.description ?? null,
          status: data.status ?? 'active',
        },
        include: { installments: true },
      })

      // Auto-generate the installment schedule.
      const installments = []
      for (let i = 0; i < data.durationMonths; i++) {
        const due = new Date(
          startDate.getFullYear(),
          startDate.getMonth() + i,
          startDate.getDate()
        )
        const inst = await tx.creditInstallment.create({
          data: {
            bankCreditId: credit.id,
            installmentNumber: i + 1,
            dueDate: due,
            amount: data.monthlyInstallment,
            status: 'pending',
          },
        })
        installments.push(inst)
      }

      return { ...credit, installments }
    })

    // Compute summary from the freshly-created credit (no repayments yet).
    const summary = await computeCreditSummary({
      id: created.id,
      originalPrincipal: created.originalPrincipal,
      durationMonths: created.durationMonths,
      startDate: created.startDate,
      monthlyInstallment: created.monthlyInstallment,
      repayments: [],
    })

    await audit({
      userId,
      entityType: 'BankCredit',
      entityId: created.id,
      operation: 'create',
      newValues: serialize({ ...created, ...summary }),
      reason: `Bank credit created: ${created.creditName} (${created.durationMonths} months)`,
    })

    return ok(serialize({ ...created, ...summary }), 201)
  })(req)
}
