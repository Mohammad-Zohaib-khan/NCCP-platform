import { createHmac, timingSafeEqual } from 'node:crypto'

/** Minimal HS256 JWT (access tokens only, short-lived). Algorithm is fixed; 'alg' from the token is never trusted. */
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')

export interface AccessClaims {
  sub: string          // user id
  sid: string          // session id (revocation check)
  role: string
  iat: number
  exp: number
}

const sign = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('base64url')

export function signAccessToken(claims: Omit<AccessClaims, 'iat' | 'exp'>, secret: string, ttlSeconds: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000)
  const body = Buffer.from(JSON.stringify({ ...claims, iat, exp: iat + ttlSeconds })).toString('base64url')
  return `${HEADER}.${body}.${sign(`${HEADER}.${body}`, secret)}`
}

export function verifyAccessToken(token: string, secret: string, now = Date.now()): AccessClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, b, s] = parts as [string, string, string]
  if (h !== HEADER) return null
  const expected = Buffer.from(sign(`${h}.${b}`, secret)); const given = Buffer.from(s)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const c = JSON.parse(Buffer.from(b, 'base64url').toString('utf8')) as Partial<AccessClaims>
    if (typeof c.sub !== 'string' || typeof c.sid !== 'string' || typeof c.role !== 'string' || typeof c.exp !== 'number' || typeof c.iat !== 'number') return null
    if (c.exp * 1000 <= now) return null
    return c as AccessClaims
  } catch { return null }
}
