import { db } from '@/lib/db'
import { withAuth, ok, fail, serialize } from '@/lib/api'

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

/** GET /api/auth/me — return the current user + app settings. */
export async function GET(req: Request) {
  return withAuth(async ({ userId }) => {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, language: true, theme: true },
    })
    if (!user) {
      return fail('User not found.', 404)
    }
    const settings = await db.appSettings.upsert({
      where: { id: 'singleton' },
      create: DEFAULT_SETTINGS,
      update: {},
    })
    return ok(serialize({ user, settings }))
  })(req)
}
