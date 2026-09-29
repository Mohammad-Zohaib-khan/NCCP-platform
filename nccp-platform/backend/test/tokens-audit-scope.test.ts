import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashRecoveryCode, hashToken, newOpaqueToken, newRecoveryCode, normaliseRecoveryCode } from '../src/auth/tokens.js'
import { redact } from '../src/audit/audit.js'
import { assertEmployerAccess, assertInstitutionAccess, assertOwnRecord, type AuthContext } from '../src/auth/context.js'

const ctx = (over: Partial<AuthContext>): AuthContext => ({ userId: 'u1', role: 'institution_admin', sessionId: 's', fullName: 'A', email: 'a@b.c', institutionIds: ['i1'], employerIds: [], mfaEnabled: false, mfaSetupRequired: false, ...over })

test('opaque tokens are unique and only the hash is derivable', () => {
  const a = newOpaqueToken(); const b = newOpaqueToken()
  assert.notEqual(a.token, b.token); assert.equal(a.hash, hashToken(a.token)); assert.notEqual(a.hash, a.token)
  assert.ok(a.token.length >= 43)
})
test('recovery codes: format, normalisation, hashing is case/dash-insensitive', () => {
  const c = newRecoveryCode()
  assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  assert.equal(hashRecoveryCode(c), hashRecoveryCode(c.toLowerCase().replace(/-/g, ' ')))
  assert.equal(normaliseRecoveryCode('ab-cd 12'), 'ABCD12')
})
test('audit redaction strips secrets at any depth', () => {
  const out = redact({ email: 'a@b.c', password: 'x', nested: { refreshToken: 't', ok: 1, list: [{ otpCode: '1' }] }, authorization: 'Bearer z' }) as Record<string, any>
  assert.equal(out.email, 'a@b.c'); assert.equal(out.password, '[REDACTED]'); assert.equal(out.nested.refreshToken, '[REDACTED]')
  assert.equal(out.nested.ok, 1); assert.equal(out.nested.list[0].otpCode, '[REDACTED]'); assert.equal(out.authorization, '[REDACTED]')
})
test('institution access: own ok, other institution -> 404, super admin bypass', () => {
  assert.doesNotThrow(() => assertInstitutionAccess(ctx({}), 'i1'))
  assert.throws(() => assertInstitutionAccess(ctx({}), 'i2'), (e: any) => e.statusCode === 404)
  assert.throws(() => assertInstitutionAccess(ctx({}), null), (e: any) => e.statusCode === 404)
  assert.doesNotThrow(() => assertInstitutionAccess(ctx({ role: 'super_admin', institutionIds: [] }), 'anything'))
})
test('employer and own-record access', () => {
  const emp = ctx({ role: 'employer', institutionIds: [], employerIds: ['e1'] })
  assert.doesNotThrow(() => assertEmployerAccess(emp, 'e1'))
  assert.throws(() => assertEmployerAccess(emp, 'e2'), (e: any) => e.statusCode === 404)
  assert.doesNotThrow(() => assertOwnRecord(ctx({ role: 'trainee' }), 'u1'))
  assert.throws(() => assertOwnRecord(ctx({ role: 'trainee' }), 'u9'), (e: any) => e.statusCode === 404)
})
