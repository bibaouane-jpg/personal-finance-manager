import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'
import { parseLocalDate, subMoney, fromCents, toCents } from '@/lib/money'

const GoalStatus = z.enum([
  'not_started',
  'in_progress',
  'completed',
  'on_hold',
  'cancelled',
])

const CreateGoalSchema = z.object({
  year: z
    .number()
    .int('Year must be a whole number.')
    .min(2000, 'Year is too far in the past.')
    .max(2200, 'Year is too far in the future.'),
  title: z
    .string()
    .trim()
    .min(1, 'Goal title is required.')
    .max(160, 'Goal title is too long (max 160 chars).'),
  description: z.string().max(280).nullable().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  status: GoalStatus.optional(),
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

/** GET /api/goals — list goals with filters + summary. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const url = new URL(req.url)
    const yearParam = url.searchParams.get('year')
    const statusParam = url.searchParams.get('status')
    const categoryIdParam = url.searchParams.get('goalCategoryId')
    const priorityParam = url.searchParams.get('priority')
    const search = url.searchParams.get('search')?.trim() || ''
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10) || 20)
    )

    const where: Record<string, unknown> = { userId }
    if (yearParam) where.year = parseInt(yearParam, 10)
    if (statusParam) where.status = statusParam
    if (categoryIdParam) where.goalCategoryId = categoryIdParam
    if (priorityParam) where.priority = parseInt(priorityParam, 10)
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
        { note: { contains: search } },
      ]
    }

    const [items, total] = await Promise.all([
      db.goal.findMany({
        where,
        include: { goalCategory: true },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.goal.count({ where }),
    ])

    // Compute remainingBudget per goal.
    const itemsWithRemaining = items.map((g) => {
      const remaining = subMoney(g.requiredBudget ?? '0', g.savedBudget ?? '0')
      return serialize({ ...g, remainingBudget: remaining })
    })

    // Build summary across all matching goals (not just the current page).
    const allMatching = await db.goal.findMany({
      where,
      select: {
        id: true,
        status: true,
        progress: true,
        requiredBudget: true,
        savedBudget: true,
        goalCategoryId: true,
        goalCategory: { select: { id: true, name: true, color: true } },
      },
    })

    let totalGoals = 0
    let completedGoals = 0
    let inProgressGoals = 0
    let requiredTotal = 0
    let savedTotal = 0
    const byCategoryMap = new Map<
      string,
      { id: string; name: string; color: string; count: number; required: number; saved: number }
    >()

    for (const g of allMatching) {
      totalGoals++
      if (g.status === 'completed') completedGoals++
      if (g.status === 'in_progress') inProgressGoals++
      requiredTotal += toCents(g.requiredBudget ?? '0')
      savedTotal += toCents(g.savedBudget ?? '0')

      const catId = g.goalCategoryId ?? 'uncategorized'
      const catName = g.goalCategory?.name ?? 'Uncategorized'
      const catColor = g.goalCategory?.color ?? '#64748b'
      let entry = byCategoryMap.get(catId)
      if (!entry) {
        entry = {
          id: catId,
          name: catName,
          color: catColor,
          count: 0,
          required: 0,
          saved: 0,
        }
        byCategoryMap.set(catId, entry)
      }
      entry.count++
      entry.required += toCents(g.requiredBudget ?? '0')
      entry.saved += toCents(g.savedBudget ?? '0')
      entry.name = catName
      entry.color = catColor
    }

    const overallProgress =
      totalGoals > 0
        ? Math.round(
            (allMatching.reduce((sum, g) => sum + g.progress, 0) / totalGoals) * 100
          ) / 100
        : 0

    const byCategory = Array.from(byCategoryMap.values()).map((c) => ({
      ...c,
      required: fromCents(c.required),
      saved: fromCents(c.saved),
    }))

    return ok(
      serialize({
        items: itemsWithRemaining,
        total,
        page,
        pageSize,
        summary: {
          totalGoals,
          completedGoals,
          inProgressGoals,
          overallProgress,
          requiredTotal: fromCents(requiredTotal),
          savedTotal: fromCents(savedTotal),
          remainingTotal: fromCents(Math.max(0, requiredTotal - savedTotal)),
          byCategory,
        },
      })
    )
  })(req)
}

/** POST /api/goals — create a goal. */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = CreateGoalSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    if (data.goalCategoryId) {
      const cat = await db.goalCategory.findFirst({
        where: { id: data.goalCategoryId, userId },
      })
      if (!cat) return fail('Goal category not found.', 400)
    }

    let progress = data.progress ?? 0
    if (data.status === 'completed') {
      progress = 100
    }

    const created = await db.goal.create({
      data: {
        userId,
        year: data.year,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority ?? 3,
        progress,
        status: data.status ?? 'not_started',
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
        note: data.note ?? null,
        goalCategoryId:
          data.goalCategoryId === undefined
            ? undefined
            : (data.goalCategoryId ?? null),
      },
      include: { goalCategory: true },
    })

    const remaining = subMoney(created.requiredBudget ?? '0', created.savedBudget ?? '0')

    await audit({
      userId,
      entityType: 'Goal',
      entityId: created.id,
      operation: 'create',
      newValues: serialize({ ...created, remainingBudget: remaining }),
      reason: `Goal created: ${created.title} (${created.year})`,
    })

    return ok(serialize({ ...created, remainingBudget: remaining }), 201)
  })(req)
}
