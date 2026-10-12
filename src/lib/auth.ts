import { NextRequest, NextResponse } from 'next/server'
import { db } from './db'
import crypto from 'crypto'

const SESSION_COOKIE = 'pfm_session'
const SESSION_MAX_AGE_DAYS = 30

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me-in-production-please-32chars'
  return secret
}

function signToken(payload: string): string {
  const secret = getSecret()
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${hmac}`
}

function verifyToken(token: string): string | null {
  if (!token || !token.includes('.')) return null
  const idx = token.lastIndexOf('.')
  const payload = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  // Use timingSafeEqual to avoid timing attacks
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!crypto.timingSafeEqual(a, b)) return null
  return payload
}

export async function createSession(userId: string): Promise<string> {
  const id = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
  await db.session.create({
    data: { id, userId, expiresAt },
  })
  return signToken(`${id}:${userId}`)
}

export async function getSession(req?: NextRequest): Promise<{ userId: string; sessionId: string } | null> {
  let token: string | undefined
  if (req) {
    token = req.cookies.get(SESSION_COOKIE)?.value
  } else {
    // Server component: read cookies via next/headers
    const { cookies } = await import('next/headers')
    token = (await cookies()).get(SESSION_COOKIE)?.value
  }
  if (!token) return null
  const payload = verifyToken(token)
  if (!payload) return null
  const [sessionId, userId] = payload.split(':')
  if (!sessionId || !userId) return null
  const session = await db.session.findUnique({ where: { id: sessionId } })
  if (!session) return null
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: sessionId } }).catch(() => {})
    return null
  }
  return { userId, sessionId }
}

export async function destroySession(sessionId: string): Promise<void> {
  await db.session.delete({ where: { id: sessionId } }).catch(() => {})
}

export function setSessionCookie(res: NextResponse, token: string): void {
  const isProduction = process.env.NODE_ENV === 'production'
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_DAYS * 24 * 60 * 60,
  })
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export { SESSION_COOKIE }

/** Hash a password with a salt using PBKDF2 (Node crypto, no external deps).
 *  For production with Argon2id, install argon2 and swap this implementation. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex')
  const iterations = 100000
  const keylen = 32
  const digest = 'sha512'
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, keylen, digest, (err, derivedKey) => {
      if (err) return reject(err)
      resolve(`pbkdf2$${digest}$${iterations}$${salt}$${derivedKey.toString('hex')}`)
    })
  })
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false
  const [, digest, iterationsStr, salt, hashHex] = parts
  const iterations = parseInt(iterationsStr, 10)
  const keylen = hashHex.length / 2
  return new Promise<boolean>((resolve) => {
    crypto.pbkdf2(password, salt, iterations, keylen, digest as crypto.DigestAlgorithm, (err, derivedKey) => {
      if (err) return resolve(false)
      const a = Buffer.from(derivedKey)
      const b = Buffer.from(hashHex, 'hex')
      if (a.length !== b.length) return resolve(false)
      resolve(crypto.timingSafeEqual(a, b))
    })
  })
}

/** Returns true if at least one user exists (admin already set up). */
export async function hasAnyUser(): Promise<boolean> {
  const count = await db.user.count()
  return count > 0
}
