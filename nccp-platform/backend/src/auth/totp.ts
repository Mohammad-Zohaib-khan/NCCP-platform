import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — compatible with Google/Microsoft Authenticator, Authy, etc. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0; let value = 0; let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}
export function base32Decode(s: string): Buffer {
  let bits = 0; let value = 0; const out: number[] = []
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(ch)
    if (idx < 0) throw new Error('invalid base32')
    value = (value << 5) | idx; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

export function newTotpSecret(): string { return base32Encode(randomBytes(20)) }

export function totpAt(secretB32: string, timeMs: number, step = 30, digits = 6): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 1000 / step)))
  const h = createHmac('sha1', base32Decode(secretB32)).update(counter).digest()
  const off = h[h.length - 1]! & 0x0f
  const code = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!
  return String(code % 10 ** digits).padStart(digits, '0')
}

/** Accepts the current step ±1 (clock drift). Returns the matched step counter (for replay protection) or null. */
export function verifyTotp(secretB32: string, code: string, now = Date.now(), window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const step = Math.floor(now / 1000 / 30)
  for (let w = -window; w <= window; w++) {
    if (totpAt(secretB32, (step + w) * 30 * 1000) === code) return step + w
  }
  return null
}

export function otpauthUri(secretB32: string, accountEmail: string, issuer = 'NCCP'): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`)
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

/** AES-256-GCM encryption of the TOTP secret at rest. Key is derived from AUTH_MFA_ENCRYPTION_KEY (falls back to AUTH_JWT_SECRET). */
const keyFrom = (secret: string) => createHash('sha256').update(`nccp-mfa-v1:${secret}`).digest()
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.')
}
export function decryptSecret(stored: string, secret: string): string {
  const [v, iv, tag, enc] = stored.split('.')
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('bad ciphertext')
  const d = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8')
}
