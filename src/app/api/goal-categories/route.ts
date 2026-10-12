import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'

const CreateGoalCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Category name is required.')
    .max(60, 'Category name is too long (max 60 chars).'),
  color: z.string().max(20).optional(),
})

/** GET /api/goal-categories — list categories. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const url = new URL(req.url)
    const search = url.searchParams.get('search')?.trim() || ''
    const where: Record<string, unknown> = { userId }
    if (search) where.name = { contains: search }

    const items = await db.goalCategory.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      include: { _count: { select: { goals: true } } },
    })

    return ok(serialize({ items }))
  })(req)
}

/** POST /api/goal-categories — create a category. */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = CreateGoalCategorySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    // Enforce unique name per user.
    const existing = await db.goalCategory.findFirst({
      where: { userId, name: data.name },
    })
    if (existing) {
      return fail('A goal category with this name already exists.', 409)
    }

    const category = await db.goalCategory.create({
      data: {
        userId,
        name: data.name,
        color: data.color ?? '#64748b',
      },
    })

    await audit({
      userId,
      entityType: 'GoalCategory',
      entityId: category.id,
      operation: 'create',
      newValues: serialize(category),
      reason: `Goal category created: ${category.name}`,
    })

    return ok(serialize(category), 201)
  })(req)
}
