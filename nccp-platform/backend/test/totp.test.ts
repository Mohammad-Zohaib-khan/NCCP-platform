import { test } from 'node:test'
import assert from 'node:assert/strict'
import { base32Decode, base32Encode, decryptSecret, encryptSecret, newTotpSecret, otpauthUri, totpAt, verifyTotp } from '../src/auth/totp.js'

// RFC 6238 Appendix B: ASCII secret "12345678901234567890", T=59s -> 8-digit 94287082 => 6-digit 287082
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'))

test('matches RFC 6238 test vectors (6-digit truncations)', () => {
  assert.equal(totpAt(RFC_SECRET, 59_000), '287082')
  assert.equal(totpAt(RFC_SECRET, 1111111109_000), '081804')
  assert.equal(totpAt(RFC_SECRET, 1234567890_000), '005924')
})
test('base32 round trip', () => {
  const b = Buffer.from('hello world!!'); assert.deepEqual(base32Decode(base32Encode(b)), b)
  assert.throws(() => base32Decode('!!!'))
})
test('verify accepts ±1 step, rejects further drift and bad formats', () => {
  const now = 1_700_000_000_000
  const code = totpAt(RFC_SECRET, now)
  assert.equal(verifyTotp(RFC_SECRET, code, now), Math.floor(now / 30000))
  assert.notEqual(verifyTotp(RFC_SECRET, code, now + 30_000), null)
  assert.equal(verifyTotp(RFC_SECRET, code, now + 120_000), null)
  assert.equal(verifyTotp(RFC_SECRET, '12345', now), null)
  assert.equal(verifyTotp(RFC_SECRET, 'abcdef', now), null)
})
test('secret encryption round trip; wrong key and tampering fail', () => {
  const s = newTotpSecret(); const key = 'k'.repeat(40)
  const enc = encryptSecret(s, key)
  assert.notEqual(enc, s); assert.equal(decryptSecret(enc, key), s)
  assert.throws(() => decryptSecret(enc, 'z'.repeat(40)))
  assert.throws(() => decryptSecret(enc.slice(0, -4) + 'AAAA', key))
})
test('otpauth uri', () => assert.match(otpauthUri('ABC', 'a@b.org'), /^otpauth:\/\/totp\/NCCP%3Aa%40b\.org\?secret=ABC&issuer=NCCP/))
