import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { hashPassword, verifyPassword } from '@/lib/auth'
import { audit } from '@/lib/audit'

const PasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z
    .string()
    .min(10, 'New password must be at least 10 characters.')
    .max(128, 'Password is too long.'),
})

/** PUT /api/auth/password — change the current user's password. */
export async function PUT(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = PasswordSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }
    const { currentPassword, newPassword } = parsed.data

    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user) {
      return fail('User not found.', 404)
    }
    const valid = await verifyPassword(currentPassword, user.passwordHash)
    if (!valid) {
      return fail('Current password is incorrect.', 400)
    }

    const passwordHash = await hashPassword(newPassword)
    await db.user.update({
      where: { id: userId },
      data: { passwordHash },
    })

    await audit({
      userId,
      entityType: 'User',
      entityId: userId,
      operation: 'update',
      previousValues: { passwordHash: '***' },
      newValues: { passwordHash: '***' },
      reason: 'Password change',
    })

    return ok(serialize({ ok: true }))
  })(req)
}
