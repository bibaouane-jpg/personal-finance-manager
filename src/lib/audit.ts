import { db } from './db'

export interface AuditInput {
  userId?: string
  entityType: string
  entityId: string
  operation: 'create' | 'update' | 'delete' | 'reverse'
  previousValues?: unknown
  newValues?: unknown
  reason?: string
}

export async function audit(input: AuditInput) {
  try {
    await db.auditLog.create({
      data: {
        userId: input.userId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        operation: input.operation,
        previousValues: input.previousValues ? JSON.stringify(input.previousValues) : null,
        newValues: input.newValues ? JSON.stringify(input.newValues) : null,
        reason: input.reason ?? null,
      },
    })
  } catch (e) {
    console.error('[audit] failed to record', e)
  }
}
