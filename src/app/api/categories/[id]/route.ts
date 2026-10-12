import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'

const CategoryType = z.enum(['income', 'expense'])

const UpdateCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Category name is required.')
    .max(60, 'Category name is too long (max 60 chars).')
    .optional(),
  type: CategoryType.optional(),
  color: z.string().max(20).optional(),
  description: z.string().max(280).nullable().optional(),
  archived: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string }> }

/** GET /api/categories/[id] — return one category. */
export async function GET(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const category = await db.category.findFirst({ where: { id, userId } })
    if (!category) {
      return fail('Category not found.', 404)
    }
    return ok(serialize(category))
  })(req)
}

/** PUT /api/categories/[id] — update category metadata. */
export async function PUT(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.category.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail('Category not found.', 404)
    }
    const parsed = UpdateCategorySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const data = parsed.data

    // Enforce (name, type) uniqueness if either is changing.
    if (data.name !== undefined || data.type !== undefined) {
      const newName = data.name ?? existing.name
      const newType = data.type ?? existing.type
      const dup = await db.category.findFirst({
        where: {
          userId,
          name: newName,
          type: newType,
          NOT: { id },
        },
      })
      if (dup) {
        return fail('A category with this name and type already exists.', 409)
      }
    }

    const updated = await db.category.update({ where: { id }, data })

    await audit({
      userId,
      entityType: 'Category',
      entityId: id,
      operation: 'update',
      previousValues: serialize(existing),
      newValues: serialize(updated),
      reason: `Category updated: ${updated.name}`,
    })

    return ok(serialize(updated))
  })(req)
}

/** DELETE /api/categories/[id] — delete if not referenced. */
export async function DELETE(req: Request, { params }: Params) {
  return withAuth(async ({ userId }) => {
    const { id } = await params
    const existing = await db.category.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail('Category not found.', 404)
    }

    // Check if referenced by any income/expense transaction or article default.
    const [incomeCount, expenseCount, articleCount] = await Promise.all([
      db.incomeTransaction.count({ where: { categoryId: id } }),
      db.expenseTransaction.count({ where: { categoryId: id } }),
      db.article.count({ where: { defaultCategoryId: id } }),
    ])

    if (incomeCount + expenseCount + articleCount > 0) {
      return fail(
        'This category is referenced by historical transactions. Archive it instead?',
        409
      )
    }

    await db.category.delete({ where: { id } })

    await audit({
      userId,
      entityType: 'Category',
      entityId: id,
      operation: 'delete',
      previousValues: serialize(existing),
      reason: `Category deleted: ${existing.name}`,
    })

    return ok(serialize({ ok: true }))
  })(req)
}
