import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, ok, fail, zodError, serialize } from '@/lib/api'
import { audit } from '@/lib/audit'

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

const UpdateSettingsSchema = z.object({
  appName: z.string().trim().max(60, 'App name is too long.').optional(),
  appNameFr: z.string().trim().max(80, 'App name (FR) is too long.').optional(),
  defaultLanguage: z.enum(['en', 'fr']).optional(),
  defaultCurrency: z.string().trim().min(1, 'Currency is required.').max(8).optional(),
  defaultTimezone: z.string().trim().min(1, 'Timezone is required.').max(64).optional(),
  referenceMonthlyIncome: z
    .string()
    .refine((v) => !isNaN(Number(v)), 'Reference monthly income must be a number.')
    .optional(),
  allocationUnitValue: z
    .string()
    .refine((v) => !isNaN(Number(v)), 'Allocation unit value must be a number.')
    .optional(),
  allowOverdraft: z.boolean().optional(),
})

/** GET /api/settings — return the AppSettings singleton, upserting defaults if missing. */
export async function GET(req: Request) {
  return withAuth(async () => {
    const settings = await db.appSettings.upsert({
      where: { id: 'singleton' },
      create: DEFAULT_SETTINGS,
      update: {},
    })
    return ok(serialize(settings))
  })(req)
}

/** PUT /api/settings — update the AppSettings singleton. */
export async function PUT(req: Request) {
  return withAuth(async ({ userId }) => {
    const parsed = UpdateSettingsSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return fail(zodError(parsed.error), 400)
    }

    // Validate appName explicitly if provided (must be non-empty after trim).
    if (parsed.data.appName !== undefined && parsed.data.appName.trim() === '') {
      return fail('App name cannot be empty.', 400)
    }

    const previous = await db.appSettings.upsert({
      where: { id: 'singleton' },
      create: DEFAULT_SETTINGS,
      update: {},
    })

    const data = parsed.data
    // Treat empty string appName as missing to keep DB column consistent.
    if (data.appName !== undefined && data.appName.trim() === '') {
      delete data.appName
    }

    const updated = await db.appSettings.update({
      where: { id: 'singleton' },
      data,
    })

    await audit({
      userId,
      entityType: 'AppSettings',
      entityId: 'singleton',
      operation: 'update',
      previousValues: serialize(previous),
      newValues: serialize(updated),
      reason: 'App settings updated',
    })

    return ok(serialize(updated))
  })(req)
}
