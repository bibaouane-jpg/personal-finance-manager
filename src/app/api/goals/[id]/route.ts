import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'
import { parseLocalDate, subMoney } from '@/lib/money'

const UpdateGoalSchema = z.object({
  year: z
    .number()
    .int()
    .min(2000, 'Year is too far in the past.')
    .max(2200, 'Year is too far in the future.')
    .optional(),
  title: z
    .string()
    .trim()
    .min(1, 'Goal title is required.')
    .max(160, 'Goal title is too long (max 160 chars).')
    .optional(),
  description: z.string().max(280).nullable().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  status: z
    .enum(['not_started', 'in_progress', 'completed', 'on_hold', 'cancelled'])
    .optional(),
  targetDate: z.string().min(1).nullable().optional(),
  requiredBudget: z
    .string()
    .refine((v) => v === '' || !isNaN(Number(v)), 'Invalid budget amount.')
    .nullable()
    .optional(),
  savedBudget: z
    .string()
    .refine((v) => v === '' || !isNaN(Number(v)), 'Invalid budget amount.')
    .nullable()
    .optional(),
  note: z.string().max(1000).nullable().optional(),
  goalCategoryId: z.string().min(1).nullable().optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/goals/[id] — return one goal with category + computed remaining budget. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const goal = await db.goal.findFirst({
      where: { id, userId },
      include: { goalCategory: true },
    })
    if (!goal) {
      return fail('Goal not found.', 404)
    }
    const remaining = subMoney(goal.requiredBudget ?? '0', goal.savedBudget ?? '0')
    return ok(serialize({ ...goal, remainingBudget: remaining }))
  })(req)
}

/** PUT /api/goals/[id] — update goal. If status becomes 'completed', set progress to 100. */
export async function PUT(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.goal.findFirst({
      where: { id, userId },
      include: { goalCategory: true },
    })
    if (!existing) {
      return fail('Goal not found.', 404)
    }

    const parsed = UpdateGoalSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    if (data.goalCategoryId !== undefined && data.goalCategoryId) {
      const cat = await db.goalCategory.findFirst({
        where: { id: data.goalCategoryId, userId },
      })
      if (!cat) return fail('Goal category not found.', 400)
    }

    // If status transitions to 'completed', force progress to 100.
    let progressPatch: { progress?: number } = {}
    if (data.status === 'completed' && existing.status !== 'completed') {
      progressPatch = { progress: 100 }
    } else if (data.progress !== undefined) {
      progressPatch = { progress: data.progress }
    }

    const updated = await db.goal.update({
      where: { id },
      data: {
        year: data.year,
        title: data.title,
        description: data.description === undefined ? undefined : (data.description ?? null),
        priority: data.priority,
        status: data.status,
        targetDate:
          data.targetDate === undefined
            ? undefined
            : data.targetDate === null
              ? null
              : parseLocalDate(data.targetDate),
        requiredBudget:
          data.requiredBudget === undefined
            ? undefined
            : data.requiredBudget === null || data.requiredBudget === ''
              ? null
              : data.requiredBudget,
        savedBudget:
          data.savedBudget === undefined
            ? undefined
            : data.savedBudget === null || data.savedBudget === ''
              ? null
              : data.savedBudget,
        note: data.note === undefined ? undefined : (data.note ?? null),
        goalCategoryId:
          data.goalCategoryId === undefined
            ? undefined
            : (data.goalCategoryId ?? null),
        ...progressPatch,
      },
      include: { goalCategory: true },
    })

    const remaining = subMoney(updated.requiredBudget ?? '0', updated.savedBudget ?? '0')

    await audit({
      userId,
      entityType: 'Goal',
      entityId: id,
      operation: 'update',
      previousValues: serialize(existing),
      newValues: serialize({ ...updated, remainingBudget: remaining }),
      reason: `Goal updated: ${updated.title}`,
    })

    return ok(serialize({ ...updated, remainingBudget: remaining }))
  })(req)
}

/** DELETE /api/goals/[id] — delete a goal. */
export async function DELETE(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.goal.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail('Goal not found.', 404)
    }

    await db.goal.delete({ where: { id } })

    await audit({
      userId,
      entityType: 'Goal',
      entityId: id,
      operation: 'delete',
      previousValues: serialize(existing),
      reason: `Goal deleted: ${existing.title}`,
    })

    return ok(serialize({ ok: true }))
  })(req)
}
