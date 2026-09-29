import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { signAccessToken, verifyAccessToken } from '../src/auth/jwt.js'

const secret = 's'.repeat(40)
const claims = { sub: 'u1', sid: 's1', role: 'trainer' }

test('round trip', () => {
  const t = signAccessToken(claims, secret, 60)
  const c = verifyAccessToken(t, secret)
  assert.equal(c?.sub, 'u1'); assert.equal(c?.sid, 's1'); assert.equal(c?.role, 'trainer')
})
test('rejects expired, wrong secret, tampered payload, malformed', () => {
  const t = signAccessToken(claims, secret, 60, Date.now() - 120_000)
  assert.equal(verifyAccessToken(t, secret), null)
  const fresh = signAccessToken(claims, secret, 60)
  assert.equal(verifyAccessToken(fresh, 'x'.repeat(40)), null)
  const [h, , s] = fresh.split('.')
  const evil = Buffer.from(JSON.stringify({ ...claims, role: 'super_admin', iat: 1, exp: 9999999999 })).toString('base64url')
  assert.equal(verifyAccessToken(`${h}.${evil}.${s}`, secret), null)
  assert.equal(verifyAccessToken('a.b', secret), null)
  assert.equal(verifyAccessToken('', secret), null)
})
test('rejects alg:none and other algorithms (header is fixed)', () => {
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ ...claims, iat: 1, exp: 9999999999 })).toString('base64url')
  assert.equal(verifyAccessToken(`${none}.${body}.`, secret), null)
  const h512 = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url')
  const sig = createHmac('sha512', secret).update(`${h512}.${body}`).digest('base64url')
  assert.equal(verifyAccessToken(`${h512}.${body}.${sig}`, secret), null)
})
