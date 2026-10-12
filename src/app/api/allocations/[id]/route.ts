import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'
import { computeAllocationProgress } from '@/lib/credit-summary'

const UpdateAllocationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Allocation name is required.')
    .max(120)
    .optional(),
  allocType: z.enum(['active', 'passive']).optional(),
  classification: z
    .enum(['credit', 'monthly_expense', 'completed', 'other'])
    .optional(),
  amount: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid amount.')
    .optional(),
  color: z.string().max(20).optional(),
  bankCreditId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  status: z.string().max(40).optional(),
  comment: z.string().max(280).nullable().optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/allocations/[id] — one allocation with computed progress. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const allocation = await db.allocation.findFirst({
      where: { id, userId },
      include: { bankCredit: true, category: true },
    })
    if (!allocation) {
      return fail('Allocation not found.', 404)
    }
    const progress = await computeAllocationProgress(allocation)
    return ok(serialize({ ...allocation, progress }))
  })(req)
}

/** PUT /api/allocations/[id] — update allocation (recompute progress if credit-linked). */
export async function PUT(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.allocation.findFirst({
      where: { id, userId },
      include: { bankCredit: true, category: true },
    })
    if (!existing) {
      return fail('Allocation not found.', 404)
    }

    const parsed = UpdateAllocationSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    if (data.bankCreditId !== undefined && data.bankCreditId) {
      const credit = await db.bankCredit.findFirst({
        where: { id: data.bankCreditId, userId },
      })
      if (!credit) return fail('Bank credit not found.', 400)
    }
    if (data.categoryId !== undefined && data.categoryId) {
      const cat = await db.category.findFirst({
        where: { id: data.categoryId, userId },
      })
      if (!cat) return fail('Category not found.', 400)
    }

    const updated = await db.allocation.update({
      where: { id },
      data: {
        name: data.name,
        allocType: data.allocType,
        classification: data.classification,
        amount: data.amount,
        color: data.color,
        bankCreditId:
          data.bankCreditId === undefined ? undefined : (data.bankCreditId ?? null),
        categoryId:
          data.categoryId === undefined ? undefined : (data.categoryId ?? null),
        // If linked to a bank credit, ignore stored progress — recompute.
        progress:
          data.bankCreditId !== undefined && data.bankCreditId
            ? 0
            : (data.progress ?? existing.progress),
        status: data.status,
        comment: data.comment === undefined ? undefined : (data.comment ?? null),
      },
      include: { bankCredit: true, category: true },
    })

    const progress = await computeAllocationProgress(updated)
    if (updated.bankCreditId) {
      await db.allocation.update({ where: { id }, data: { progress } })
    }

    await audit({
      userId,
      entityType: 'Allocation',
      entityId: id,
      operation: 'update',
      previousValues: serialize(existing),
      newValues: serialize({ ...updated, progress }),
      reason: `Allocation updated: ${updated.name}`,
    })

    return ok(serialize({ ...updated, progress }))
  })(req)
}

/** DELETE /api/allocations/[id] — delete the allocation (planning record). */
export async function DELETE(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.allocation.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail('Allocation not found.', 404)
    }

    await db.allocation.delete({ where: { id } })

    await audit({
      userId,
      entityType: 'Allocation',
      entityId: id,
      operation: 'delete',
      previousValues: serialize(existing),
      reason: `Allocation deleted: ${existing.name}`,
    })

    return ok(serialize({ ok: true }))
  })(req)
}
