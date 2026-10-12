import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api'
import { getSession, destroySession, clearSessionCookie } from '@/lib/auth'

/** POST /api/auth/logout — destroy the current session and clear the cookie. */
export async function POST(req: Request) {
  return withAuth(async () => {
    // In Next.js 16, read cookies via next/headers (getSession() with no args).
    const session = await getSession()
    if (session) {
      await destroySession(session.sessionId)
    }
    const res = NextResponse.json({ ok: true })
    clearSessionCookie(res)
    return res
  })(req)
}
