import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail } from '@/lib/api'
import { audit } from '@/lib/audit'

const Schema = z.object({
  language: z.enum(['en', 'fr']).optional(),
  theme: z.enum(['light', 'dark']).optional(),
})

export const PUT = withAuth(async ({ req, userId }) => {
  const body = await req.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Invalid input', 400)
  }
  const data: { language?: string; theme?: string } = {}
  if (parsed.data.language) data.language = parsed.data.language
  if (parsed.data.theme) data.theme = parsed.data.theme
  if (Object.keys(data).length === 0) {
    return fail('Nothing to update', 400)
  }
  const user = await db.user.update({ where: { id: userId }, data, select: { id: true, language: true, theme: true, email: true, name: true } })
  await audit({ userId, entityType: 'User', entityId: userId, operation: 'update', newValues: data })
  return ok({ user })
})
