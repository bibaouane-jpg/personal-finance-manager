import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'
import { addMoney, fromCents, toCents } from '@/lib/money'
import { computeAllocationProgress } from '@/lib/credit-summary'

const AllocType = z.enum(['active', 'passive'])
const Classification = z.enum(['credit', 'monthly_expense', 'completed', 'other'])

const CreateAllocationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Allocation name is required.')
    .max(120, 'Allocation name is too long (max 120 chars).'),
  allocType: AllocType,
  classification: Classification,
  amount: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid amount.'),
  color: z.string().max(20).optional(),
  bankCreditId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  status: z.string().max(40).optional(),
  comment: z.string().max(280).nullable().optional(),
})

/** GET /api/allocations — list allocations with computed progress + summary. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const url = new URL(req.url)
    const typeParam = url.searchParams.get('type')
    const classificationParam = url.searchParams.get('classification')
    const statusParam = url.searchParams.get('status')
    const search = url.searchParams.get('search')?.trim() || ''

    const where: Record<string, unknown> = { userId }
    if (typeParam === 'active' || typeParam === 'passive') {
      where.allocType = typeParam
    }
    if (
      classificationParam === 'credit' ||
      classificationParam === 'monthly_expense' ||
      classificationParam === 'completed' ||
      classificationParam === 'other'
    ) {
      where.classification = classificationParam
    }
    if (statusParam) where.status = statusParam
    if (search) where.name = { contains: search }

    const allocations = await db.allocation.findMany({
      where,
      include: { bankCredit: true, category: true },
      orderBy: [{ allocType: 'asc' }, { createdAt: 'desc' }],
    })

    const items = []
    for (const a of allocations) {
      const progress = await computeAllocationProgress(a)
      items.push(serialize({ ...a, progress }))
    }

    const settings = await db.appSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    })
    const referenceIncome = settings.referenceMonthlyIncome
    const unitValue = settings.allocationUnitValue

    let totalActive = 0
    let totalPassive = 0
    for (const a of items as Array<{ allocType: string; amount: string }>) {
      const cents = toCents(a.amount)
      if (a.allocType === 'active') totalActive += cents
      else totalPassive += cents
    }
    const totalAllocated = totalActive + totalPassive
    const refCents = toCents(referenceIncome)
    const unallocated = Math.max(0, refCents - totalActive)
    const utilization = refCents > 0 ? (totalActive / refCents) * 100 : 0
    const available = unallocated

    return ok(
      serialize({
        items,
        summary: {
          referenceIncome,
          unitValue,
          totalActive: fromCents(totalActive),
          totalPassive: fromCents(totalPassive),
          totalAllocated: fromCents(totalAllocated),
          unallocated: fromCents(unallocated),
          utilization: Math.round(utilization * 100) / 100,
          available: fromCents(available),
        },
      })
    )
  })(req)
}

/** POST /api/allocations — create an allocation. */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = CreateAllocationSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    if (data.bankCreditId) {
      const credit = await db.bankCredit.findFirst({
        where: { id: data.bankCreditId, userId },
      })
      if (!credit) return fail('Bank credit not found.', 400)
    }
    if (data.categoryId) {
      const cat = await db.category.findFirst({
        where: { id: data.categoryId, userId },
      })
      if (!cat) return fail('Category not found.', 400)
    }

    const created = await db.allocation.create({
      data: {
        userId,
        name: data.name,
        allocType: data.allocType,
        classification: data.classification,
        amount: data.amount,
        color: data.color ?? '#64748b',
        bankCreditId: data.bankCreditId ?? null,
        categoryId: data.categoryId ?? null,
        progress: data.bankCreditId ? 0 : (data.progress ?? 0),
        status: data.status ?? 'active',
        comment: data.comment ?? null,
      },
      include: { bankCredit: true, category: true },
    })

    const progress = await computeAllocationProgress(created)
    if (created.bankCreditId) {
      await db.allocation.update({ where: { id: created.id }, data: { progress } })
    }

    await audit({
      userId,
      entityType: 'Allocation',
      entityId: created.id,
      operation: 'create',
      newValues: serialize({ ...created, progress }),
      reason: `Allocation created: ${created.name}`,
    })

    return ok(serialize({ ...created, progress }), 201)
  })(req)
}
