import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Opaque random token (URL-safe). Only its SHA-256 hash is ever stored. */
export function newOpaqueToken(bytes = 32): { token: string; hash: string } {
  const token = randomBytes(bytes).toString('base64url')
  return { token, hash: hashToken(token) }
}
export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex') }

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Human-friendly recovery code, e.g. 'K7QM-2XPD-9TRA' (unambiguous alphabet). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function newRecoveryCode(): string {
  const b = randomBytes(12)
  let s = ''
  for (let i = 0; i < 12; i++) { s += ALPHABET[b[i]! % ALPHABET.length]; if (i % 4 === 3 && i < 11) s += '-' }
  return s
}
export function normaliseRecoveryCode(input: string): string { return input.toUpperCase().replace(/[^A-Z0-9]/g, '') }
export function hashRecoveryCode(input: string): string { return hashToken(normaliseRecoveryCode(input)) }
