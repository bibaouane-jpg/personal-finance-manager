import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'

const CategoryType = z.enum(['income', 'expense'])

const CreateCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Category name is required.')
    .max(60, 'Category name is too long (max 60 chars).'),
  type: CategoryType,
  color: z.string().max(20).optional(),
  description: z.string().max(280).optional(),
})

function parseBool(v: string | null): boolean | undefined {
  if (v === null) return undefined
  if (v === 'true') return true
  if (v === 'false') return false
  return undefined
}

/** GET /api/categories — list the user's categories. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const url = new URL(req.url)
    const typeParam = url.searchParams.get('type')
    const archivedParam = parseBool(url.searchParams.get('archived'))
    const search = url.searchParams.get('search')?.trim() || ''

    const where: Record<string, unknown> = { userId }
    if (typeParam === 'income' || typeParam === 'expense') {
      where.type = typeParam
    }
    if (archivedParam !== undefined) {
      where.archived = archivedParam
    } else {
      // default to non-archived only
      where.archived = false
    }
    if (search) {
      where.name = { contains: search }
    }

    const items = await db.category.findMany({
      where,
      orderBy: [{ name: 'asc' }],
    })

    return ok(serialize({ items }))
  })(req)
}

/** POST /api/categories — create a new category. */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = CreateCategorySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    // Enforce a unique (name, type) per user.
    const existing = await db.category.findFirst({
      where: { userId, name: data.name, type: data.type },
    })
    if (existing) {
      return fail('A category with this name and type already exists.', 409)
    }

    const category = await db.category.create({
      data: {
        userId,
        name: data.name,
        type: data.type,
        color: data.color ?? '#64748b',
        description: data.description ?? null,
      },
    })

    await audit({
      userId,
      entityType: 'Category',
      entityId: category.id,
      operation: 'create',
      newValues: serialize(category),
      reason: `Category created: ${category.name} (${category.type})`,
    })

    return ok(serialize(category), 201)
  })(req)
}
