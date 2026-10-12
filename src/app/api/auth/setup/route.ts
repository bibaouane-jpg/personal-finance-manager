import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  createSession,
  setSessionCookie,
  hashPassword,
  hasAnyUser,
} from '@/lib/auth'
import { audit } from '@/lib/audit'
import { serialize, fail, zodError } from '@/lib/api'

const SetupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80, 'Name is too long.'),
  email: z.string().trim().email('A valid email is required.'),
  password: z.string().min(10, 'Password must be at least 10 characters.').max(128),
})

const DEFAULT_SETTINGS = {
  id: 'singleton',
  appName: 'Personal Finance Manager',
  appNameFr: 'Gestionnaire de Finances Personnelles',
  defaultCurrency: 'MAD',
  defaultTimezone: 'Africa/Casablanca',
  referenceMonthlyIncome: '25000',
  allocationUnitValue: '500',
  allowOverdraft: false,
}

/** POST /api/auth/setup — first-run admin creation. */
export async function POST(req: Request) {
  if (await hasAnyUser()) {
    return fail('Administrator already set up.', 409)
  }

  const parsed = SetupSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return fail(zodError(parsed.error), 400)
  }
  const { name, email, password } = parsed.data

  // Ensure the AppSettings singleton exists (idempotent).
  const settings = await db.appSettings.upsert({
    where: { id: 'singleton' },
    create: DEFAULT_SETTINGS,
    update: {},
  })

  const passwordHash = await hashPassword(password)
  const user = await db.user.create({
    data: {
      email: email.toLowerCase(),
      name,
      passwordHash,
      language: 'en',
      theme: 'light',
    },
  })

  const token = await createSession(user.id)
  const res = NextResponse.json(
    serialize({
      user: { id: user.id, email: user.email, name: user.name, language: user.language, theme: user.theme },
      settings,
    }),
    { status: 201 }
  )
  setSessionCookie(res, token)

  await audit({
    userId: user.id,
    entityType: 'User',
    entityId: user.id,
    operation: 'create',
    newValues: { id: user.id, email: user.email, name: user.name, role: 'admin' },
    reason: 'Initial administrator setup',
  })

  return res
}
