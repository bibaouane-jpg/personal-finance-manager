import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'

const ArticleType = z.enum(['income', 'expense'])

const UpdateArticleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Article name is required.')
    .max(80, 'Article name is too long (max 80 chars).')
    .optional(),
  type: ArticleType.optional(),
  description: z.string().max(280).nullable().optional(),
  defaultAmount: z
    .string()
    .refine((v) => v !== '' && !isNaN(Number(v)), 'Invalid amount')
    .optional(),
  defaultCategoryId: z.string().min(1).nullable().optional(),
  active: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/articles/[id] — return one article. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const article = await db.article.findFirst({
      where: { id, userId },
      include: { defaultCategory: true },
    })
    if (!article) {
      return fail('Article not found.', 404)
    }
    return ok(serialize(article))
  })(req)
}

/** PUT /api/articles/[id] — update article. */
export async function PUT(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.article.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail('Article not found.', 404)
    }
    const parsed = UpdateArticleSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    // Validate default category if changed.
    if (data.defaultCategoryId !== undefined && data.defaultCategoryId !== null) {
      const cat = await db.category.findFirst({
        where: { id: data.defaultCategoryId, userId },
      })
      if (!cat) {
        return fail('Default category not found.', 400)
      }
      const effectiveType = data.type ?? existing.type
      if (cat.type !== effectiveType) {
        return fail('Default category type must match the article type.', 400)
      }
    }

    // Enforce unique (name, type) if either is changing.
    if (data.name !== undefined || data.type !== undefined) {
      const newName = data.name ?? existing.name
      const newType = data.type ?? existing.type
      const dup = await db.article.findFirst({
        where: { userId, name: newName, type: newType, NOT: { id } },
      })
      if (dup) {
        return fail('An article with this name and type already exists.', 409)
      }
    }

    const updated = await db.article.update({
      where: { id },
      data,
      include: { defaultCategory: true },
    })

    await audit({
      userId,
      entityType: 'Article',
      entityId: id,
      operation: 'update',
      previousValues: serialize(existing),
      newValues: serialize(updated),
      reason: `Article updated: ${updated.name}`,
    })

    return ok(serialize(updated))
  })(req)
}

/** DELETE /api/articles/[id] — delete if not referenced by transactions. */
export async function DELETE(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.article.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail('Article not found.', 404)
    }

    const [incomeCount, expenseCount] = await Promise.all([
      db.incomeTransaction.count({ where: { articleId: id } }),
      db.expenseTransaction.count({ where: { articleId: id } }),
    ])

    if (incomeCount + expenseCount > 0) {
      return fail(
        'Cannot delete an article referenced by transactions. Deactivate it instead.',
        409
      )
    }

    await db.article.delete({ where: { id } })

    await audit({
      userId,
      entityType: 'Article',
      entityId: id,
      operation: 'delete',
      previousValues: serialize(existing),
      reason: `Article deleted: ${existing.name}`,
    })

    return ok(serialize({ ok: true }))
  })(req)
}
