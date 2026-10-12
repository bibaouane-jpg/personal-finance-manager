import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'

const ArticleType = z.enum(['income', 'expense'])

const CreateArticleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Article name is required.')
    .max(80, 'Article name is too long (max 80 chars).'),
  type: ArticleType,
  description: z.string().max(280).optional(),
  defaultAmount: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid amount'),
  defaultCategoryId: z.string().min(1).optional(),
  active: z.boolean().optional(),
})

function parseBool(v: string | null): boolean | undefined {
  if (v === null) return undefined
  if (v === 'true') return true
  if (v === 'false') return false
  return undefined
}

/** GET /api/articles — list the user's articles. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const url = new URL(req.url)
    const typeParam = url.searchParams.get('type')
    const activeParam = parseBool(url.searchParams.get('active'))
    const search = url.searchParams.get('search')?.trim() || ''

    const where: Record<string, unknown> = { userId }
    if (typeParam === 'income' || typeParam === 'expense') {
      where.type = typeParam
    }
    if (activeParam !== undefined) {
      where.active = activeParam
    } else {
      where.active = true
    }
    if (search) {
      where.name = { contains: search }
    }

    const items = await db.article.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      include: { defaultCategory: true },
    })

    return ok(serialize({ items }))
  })(req)
}

/** POST /api/articles — create a new article. */
export async function POST(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = CreateArticleSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    // If defaultCategoryId is provided, ensure it belongs to the user and matches type.
    if (data.defaultCategoryId) {
      const cat = await db.category.findFirst({
        where: { id: data.defaultCategoryId, userId },
      })
      if (!cat) {
        return fail('Default category not found.', 400)
      }
      if (cat.type !== data.type) {
        return fail('Default category type must match the article type.', 400)
      }
    }

    // Enforce unique (name, type) per user.
    const existing = await db.article.findFirst({
      where: { userId, name: data.name, type: data.type },
    })
    if (existing) {
      return fail('An article with this name and type already exists.', 409)
    }

    const article = await db.article.create({
      data: {
        userId,
        name: data.name,
        type: data.type,
        description: data.description ?? null,
        defaultAmount: data.defaultAmount,
        defaultCategoryId: data.defaultCategoryId ?? null,
        active: data.active ?? true,
      },
      include: { defaultCategory: true },
    })

    await audit({
      userId,
      entityType: 'Article',
      entityId: article.id,
      operation: 'create',
      newValues: serialize(article),
      reason: `Article created: ${article.name} (${article.type})`,
    })

    return ok(serialize(article), 201)
  })(req)
}
