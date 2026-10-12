import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  createSession,
  setSessionCookie,
  verifyPassword,
  hasAnyUser,
} from '@/lib/auth'
import { serialize, fail, zodError } from '@/lib/api'

const LoginSchema = z.object({
  email: z.string().trim().email('A valid email is required.'),
  password: z.string().min(1, 'Password is required.'),
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

/** POST /api/auth/login — authenticate an existing user. */
export async function POST(req: Request) {
  if (!(await hasAnyUser())) {
    return fail('No account exists yet.', 404)
  }

  const parsed = LoginSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return fail(zodError(parsed.error), 400)
  }
  const { email, password } = parsed.data

  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user) {
    return fail('Invalid email or password.', 401)
  }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    return fail('Invalid email or password.', 401)
  }

  const settings = await db.appSettings.upsert({
    where: { id: 'singleton' },
    create: DEFAULT_SETTINGS,
    update: {},
  })

  const token = await createSession(user.id)
  const res = NextResponse.json(
    serialize({
      user: { id: user.id, email: user.email, name: user.name, language: user.language, theme: user.theme },
      settings,
    })
  )
  setSessionCookie(res, token)
  return res
}
