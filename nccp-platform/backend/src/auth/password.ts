import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * Password hashing with Node's built-in scrypt (no native build needed).
 * Stored format: scrypt$N$r$p$saltB64$hashB64 — parameters live in the hash, so they can be raised later
 * and old hashes still verify (use needsRehash() after a successful login).
 * Argon2id can be added later behind the same hashPassword/verifyPassword interface.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keyLen: 64 }
const MAX_PASSWORD_LENGTH = 128

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keyLen: number): Promise<Buffer> {
  const opts: ScryptOptions = { N, r, p, maxmem: 128 * N * r * 2 }
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, PARAMS.N, PARAMS.r, PARAMS.p, PARAMS.keyLen)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || password.length > MAX_PASSWORD_LENGTH) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string]
  const expected = Buffer.from(hashB64, 'base64')
  try {
    const actual = await derive(password, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p), expected.length)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch { return false }
}

export function needsRehash(stored: string): boolean {
  const [, n, r, p] = stored.split('$')
  return Number(n) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p
}

/** A fixed dummy hash so login for unknown emails costs the same time as for known ones (no user enumeration). */
let dummy: Promise<string> | undefined
export function dummyHash(): Promise<string> { return (dummy ??= hashPassword('dummy-password-for-timing')) }

export interface PasswordIssue { message: string }
const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', 'qwertyuiop', 'iloveyou1', 'admin1234', 'welcome123', 'letmein123'])

/** Policy: 10–128 chars, not a common password, not containing the email local part, at least 3 of 4 character classes. */
export function checkPasswordPolicy(password: string, ctx: { email?: string; fullName?: string } = {}): PasswordIssue[] {
  const issues: PasswordIssue[] = []
  if (password.length < 10) issues.push({ message: 'Password must be at least 10 characters' })
  if (password.length > MAX_PASSWORD_LENGTH) issues.push({ message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` })
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length
  if (classes < 3) issues.push({ message: 'Use at least three of: lowercase, uppercase, digits, symbols' })
  const lower = password.toLowerCase()
  if (COMMON.has(lower)) issues.push({ message: 'Password is too common' })
  const local = ctx.email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && lower.includes(local)) issues.push({ message: 'Password must not contain your email name' })
  return issues
}
