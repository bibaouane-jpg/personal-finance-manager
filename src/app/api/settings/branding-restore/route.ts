import { db } from '@/lib/db'
import { withAuth, ok, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'

const DEFAULT_APP_NAME = 'Personal Finance Manager'
const DEFAULT_APP_NAME_FR = 'Gestionnaire de Finances Personnelles'

/** PATCH /api/settings/branding-restore — reset the app name to defaults. */
export async function PATCH(req: Request) {
  return withAuth(async ({ userId }) => {
    const previous = await db.appSettings.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        appName: DEFAULT_APP_NAME,
        appNameFr: DEFAULT_APP_NAME_FR,
        defaultCurrency: 'MAD',
        defaultTimezone: 'Africa/Casablanca',
        referenceMonthlyIncome: '25000',
        allocationUnitValue: '500',
        allowOverdraft: false,
      },
      update: {},
    })

    const updated = await db.appSettings.update({
      where: { id: 'singleton' },
      data: { appName: DEFAULT_APP_NAME, appNameFr: DEFAULT_APP_NAME_FR },
    })

    await audit({
      userId,
      entityType: 'AppSettings',
      entityId: 'singleton',
      operation: 'update',
      previousValues: serialize(previous),
      newValues: serialize(updated),
      reason: 'Branding restored to defaults',
    })

    return ok(serialize(updated))
  })(req)
}
