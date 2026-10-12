import { NextResponse } from 'next/server'
import { hasAnyUser } from '@/lib/auth'

/**
 * GET /api/auth/status
 * Public endpoint: tells the login page whether to show "setup" or "login".
 */
export async function GET() {
  const setupComplete = await hasAnyUser()
  return NextResponse.json({ setupComplete })
}
