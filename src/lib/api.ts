import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getSession } from './auth'

/** Wraps an API handler with auth + error handling. Returns 401 if not authenticated. */
export function withAuth<T extends { userId: string }>(
  handler: (ctx: { req: Request; userId: string }) => Promise<NextResponse>
) {
  return async (req: Request): Promise<NextResponse> => {
    try {
      // In Next.js 16, NextRequest(req) does not reliably expose cookies
      // (private #state errors). Fall back to next/headers cookies() which
      // works inside route handlers.
      const session = await getSession()
      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return await handler({ req, userId: session.userId })
    } catch (e) {
      console.error('[api error]', e)
      const message = e instanceof Error ? e.message : 'Internal server error'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }
}

/** Format a Zod error into a human readable message. */
export function zodError(e: ZodError): string {
  const first = e.issues[0]
  if (!first) return 'Validation failed'
  return first.message
}

/** Standard JSON response helper. */
export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** Standard JSON error response helper. */
export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** Serialize a Decimal-bearing Prisma object for the client. */
export function serialize<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (_k, v) => {
    if (v && typeof v === 'object' && 'toString' in v && typeof v.toString === 'function') {
      // Prisma Decimal objects serialize awkwardly; convert to string.
      if (v.constructor && v.constructor.name === 'Decimal') return v.toString()
    }
    return v
  })) as T
}
