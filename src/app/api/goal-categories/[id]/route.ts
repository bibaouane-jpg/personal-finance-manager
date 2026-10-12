import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'

const UpdateGoalCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Category name is required.')
    .max(60, 'Category name is too long (max 60 chars).')
    .optional(),
  color: z.string().max(20).optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/goal-categories/[id] — return one category. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const category = await db.goalCategory.findFirst({
      where: { id, userId },
      include: { _count: { select: { goals: true } } },
    })
    if (!category) {
      return fail('Goal category not found.', 404)
    }
    return ok(serialize(category))
  })(req)
}

/** PUT /api/goal-categories/[id] — update category. */
export async function PUT(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.goalCategory.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail('Goal category not found.', 404)
    }

    const parsed = UpdateGoalCategorySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    if (data.name !== undefined) {
      const dup = await db.goalCategory.findFirst({
        where: { userId, name: data.name, NOT: { id } },
      })
      if (dup) {
        return fail('A goal category with this name already exists.', 409)
      }
    }

    const updated = await db.goalCategory.update({ where: { id }, data })

    await audit({
      userId,
      entityType: 'GoalCategory',
      entityId: id,
      operation: 'update',
      previousValues: serialize(existing),
      newValues: serialize(updated),
      reason: `Goal category updated: ${updated.name}`,
    })

    return ok(serialize(updated))
  })(req)
}

/** DELETE /api/goal-categories/[id] — refuse if referenced by goals. */
export async function DELETE(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.goalCategory.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail('Goal category not found.', 404)
    }

    const goalCount = await db.goal.count({ where: { goalCategoryId: id } })
    if (goalCount > 0) {
      return fail('Cannot delete a category referenced by goals.', 409)
    }

    await db.goalCategory.delete({ where: { id } })

    await audit({
      userId,
      entityType: 'GoalCategory',
      entityId: id,
      operation: 'delete',
      previousValues: serialize(existing),
      reason: `Goal category deleted: ${existing.name}`,
    })

    return ok(serialize({ ok: true }))
  })(req)
}
