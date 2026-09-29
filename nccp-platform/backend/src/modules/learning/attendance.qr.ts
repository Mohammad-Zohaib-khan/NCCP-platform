import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { AppError } from '../../lib/errors.js'

/**
 * Short-lived, session-bound QR proof.  Token = `v1.<expiresAtEpochSec>.<nonce>.<sig>` where
 * sig = base64url(HMAC-SHA256(sessionSecret, `${sessionId}.${exp}.${nonce}`)).
 * The secret is random per opened attendance session and is replaced on every (re)open, so tokens from an earlier
 * opening, another session, or a closed session never verify. A printed/static QR cannot work: it would expire in seconds.
 * The trainer screen re-fetches a fresh token before the old one expires. Tokens are not single-use (a whole room scans
 * the same code); one record per trainee per session is enforced by the database.
 */
export const QR_TTL_SECONDS = 30
export const newQrSecret = (): string => randomBytes(32).toString('hex')

const sign = (secret: string, sessionId: string, exp: number, nonce: string): string =>
  createHmac('sha256', secret).update(`${sessionId}.${exp}.${nonce}`).digest('base64url')

export function issueQrToken(secret: string, sessionId: string, nowMs: number, ttlSeconds = QR_TTL_SECONDS): { token: string; expiresAt: string; ttlSeconds: number } {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds
  const nonce = randomBytes(6).toString('hex')
  return { token: `v1.${exp}.${nonce}.${sign(secret, sessionId, exp, nonce)}`, expiresAt: new Date(exp * 1000).toISOString(), ttlSeconds }
}

/** Throws 422 for a malformed/forged token and 409 (details.code QR_EXPIRED) for an expired one. */
export function verifyQrToken(token: string, secret: string, sessionId: string, nowMs: number): void {
  const bad = () => AppError.validation([{ path: 'token', message: 'Invalid QR code' }])
  const parts = token.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw bad()
  const [, expRaw, nonce, sig] = parts as [string, string, string, string]
  if (!/^\d{9,12}$/.test(expRaw) || !/^[0-9a-f]{12}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) throw bad()
  const expected = Buffer.from(sign(secret, sessionId, Number(expRaw), nonce))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw bad()   // signature first: never leak expiry of a forged token
  if (Math.floor(nowMs / 1000) >= Number(expRaw)) throw AppError.conflict('This QR code has expired; scan the current code', { code: 'QR_EXPIRED' })
}
