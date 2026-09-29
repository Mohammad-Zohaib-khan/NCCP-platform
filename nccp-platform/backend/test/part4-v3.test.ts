import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { AppError } from '../src/lib/errors.js'
import { issueQrToken, newQrSecret, QR_TTL_SECONDS, verifyQrToken } from '../src/modules/learning/attendance.qr.js'
import { assertNoSimulationInProduction, attendanceFeatureIssues, createSimulatedFingerprintProvider, fingerprintSimulatorAllowed, noDeviceFingerprintProvider, noFaceProvider, pickFingerprintProvider, type AttendanceFeatures } from '../src/modules/learning/biometric.js'
import { STAFF_MARK_METHODS, SELF_CHECKIN_METHODS } from '../src/modules/learning/attendance.rules.js'
import { assertEnabledLanguage, isLanguageTag, overlayText, parseLanguageList, pickLanguage } from '../src/lib/i18n.js'

const throwsApp = (fn: () => unknown, status: number) => assert.throws(fn, (e: unknown) => e instanceof AppError && e.statusCode === status)
const rejectsApp = async (p: Promise<unknown>, status: number) => assert.rejects(p, (e: unknown) => e instanceof AppError && e.statusCode === status)
const F = (o: Partial<AttendanceFeatures> = {}): AttendanceFeatures => ({ qrAttendance: true, faceAttendance: false, fingerprintDemo: false, ...o })

describe('QR attendance token', () => {
  const secret = newQrSecret(); const sid = '11111111-1111-4111-8111-111111111111'; const t0 = 1_800_000_000_000
  test('a fresh token verifies and carries the ttl', () => {
    const t = issueQrToken(secret, sid, t0)
    assert.equal(t.ttlSeconds, QR_TTL_SECONDS)
    assert.doesNotThrow(() => verifyQrToken(t.token, secret, sid, t0 + 1000))
    assert.doesNotThrow(() => verifyQrToken(t.token, secret, sid, t0 + (QR_TTL_SECONDS - 1) * 1000))
  })
  test('expired token is 409 QR_EXPIRED', () => {
    const t = issueQrToken(secret, sid, t0)
    assert.throws(() => verifyQrToken(t.token, secret, sid, t0 + (QR_TTL_SECONDS + 1) * 1000), (e: unknown) => e instanceof AppError && e.statusCode === 409 && (e.details as { code: string }).code === 'QR_EXPIRED')
  })
  test('token is bound to its session and to the secret of that opening', () => {
    const t = issueQrToken(secret, sid, t0)
    throwsApp(() => verifyQrToken(t.token, secret, '22222222-2222-4222-8222-222222222222', t0), 422)   // other session
    throwsApp(() => verifyQrToken(t.token, newQrSecret(), sid, t0), 422)                               // secret replaced by a reopen
  })
  test('tampering is 422, and a forged token never reveals whether it is expired', () => {
    const t = issueQrToken(secret, sid, t0)
    const [v, exp, nonce, sig] = t.token.split('.') as [string, string, string, string]
    throwsApp(() => verifyQrToken(`${v}.${Number(exp) + 600}.${nonce}.${sig}`, secret, sid, t0), 422)   // extended expiry
    const tamperedSig = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')
    throwsApp(() => verifyQrToken(`${v}.${exp}.${nonce}.${tamperedSig}`, secret, sid, t0 + 999_000), 422)   // forged AND past expiry -> still 422
    for (const junk of ['', 'abc', 'v1.1.2.3', `v2.${exp}.${nonce}.${sig}`, `${t.token}.extra`]) throwsApp(() => verifyQrToken(junk, secret, sid, t0), 422)
  })
  test('tokens differ every issue (nonce), so a static QR cannot be reused', () => {
    assert.notEqual(issueQrToken(secret, sid, t0).token, issueQrToken(secret, sid, t0).token)
  })
})

describe('biometric policy: simulated fingerprint (Space key) is development/demo only', () => {
  test('production config with the demo flag is a startup error', () => {
    assert.equal(attendanceFeatureIssues('production', F({ fingerprintDemo: true })).length, 1)
    for (const env of ['development', 'test', 'staging'] as const) assert.deepEqual(attendanceFeatureIssues(env, F({ fingerprintDemo: true })), [])
    assert.deepEqual(attendanceFeatureIssues('production', F()), [])
  })
  test('the simulator exists only when the flag is on and NODE_ENV is not production', () => {
    assert.equal(fingerprintSimulatorAllowed('development', F({ fingerprintDemo: true })), true)
    assert.equal(fingerprintSimulatorAllowed('development', F()), false)
    assert.equal(fingerprintSimulatorAllowed('production', F({ fingerprintDemo: true })), false)   // even if the flag somehow got through
    assert.throws(() => createSimulatedFingerprintProvider('production', F({ fingerprintDemo: true })))
  })
  test('development: Space succeeds, any other key fails', async () => {
    const p = pickFingerprintProvider('development', F({ fingerprintDemo: true }))
    assert.equal(p.name, 'simulated-space-key')
    assert.deepEqual(await p.verify({ traineeId: 't', sessionId: 's', simulatedKey: 'Space' }), { ok: true, verification: 'fingerprint_simulated' })
    assert.equal((await p.verify({ traineeId: 't', sessionId: 's', simulatedKey: 'Enter' })).ok, false)
    assert.equal((await p.verify({ traineeId: 't', sessionId: 's' })).ok, false)
  })
  test('production (and demo-off) has no simulator: verification is 503, simulated success is impossible', async () => {
    for (const p of [pickFingerprintProvider('production', F({ fingerprintDemo: true })), pickFingerprintProvider('development', F()), pickFingerprintProvider('production', F())]) {
      assert.equal(p, noDeviceFingerprintProvider)
      await rejectsApp(p.verify({ traineeId: 't', sessionId: 's', simulatedKey: 'Space' }), 503)
    }
  })
  test('production rejects a request that even carries a simulated key (403); development accepts the field', () => {
    throwsApp(() => assertNoSimulationInProduction('production', { simulatedKey: 'Space' }), 403)
    assert.doesNotThrow(() => assertNoSimulationInProduction('production', {}))
    assert.doesNotThrow(() => assertNoSimulationInProduction('development', { simulatedKey: 'Space' }))
  })
  test('a real provider can be plugged in without touching attendance logic', async () => {
    const real = { name: 'acme-usb', async verify() { return { ok: true, verification: 'fingerprint_device' as const } } }
    assert.equal(pickFingerprintProvider('production', F(), real), real)
  })
  test('face recognition is unavailable by default and never blocks anything else', async () => {
    assert.equal(noFaceProvider.available, false)
    await rejectsApp(noFaceProvider.verify({ traineeId: 't', sessionId: 's' }), 503)
  })
  test('verified methods are never claimable or hand-writable', () => {
    for (const m of ['qr', 'fingerprint', 'face'] as const) { assert.ok(!SELF_CHECKIN_METHODS.includes(m)); assert.ok(!STAFF_MARK_METHODS.includes(m)) }
  })
})

describe('language selection and fallback', () => {
  const cfg = { defaultLanguage: 'en', enabledLanguages: ['en', 'hi'] }
  test('tags and lists', () => {
    assert.ok(isLanguageTag('hi') && isLanguageTag('pt-BR') && !isLanguageTag('English') && !isLanguageTag('e') && !isLanguageTag('en_US'))
    assert.deepEqual(parseLanguageList(' en, hi ,en'), ['en', 'hi'])
    assert.throws(() => parseLanguageList('en,x y'))
  })
  test('explicit request beats saved preference beats default; unknown request is 422; stale preference falls back', () => {
    assert.equal(pickLanguage(cfg, 'hi', 'en'), 'hi')
    assert.equal(pickLanguage(cfg, undefined, 'hi'), 'hi')
    assert.equal(pickLanguage(cfg, undefined, 'ta'), 'en')
    assert.equal(pickLanguage(cfg, undefined, null), 'en')
    throwsApp(() => pickLanguage(cfg, 'fr', 'hi'), 422)
    throwsApp(() => assertEnabledLanguage(cfg, 'ta'), 422)
  })
  test('overlay: translated fields win, null fields fall back to base, missing translation is flagged untranslated', () => {
    const base = { id: 'x', title: 'Basics', content: 'English body', progress: 'completed' }
    const t = overlayText(base, { title: 'बुनियादी', content: null }, ['title', 'content'])
    assert.deepEqual(t, { id: 'x', title: 'बुनियादी', content: 'English body', progress: 'completed', translated: true })   // progress untouched
    assert.deepEqual(overlayText(base, undefined, ['title', 'content']), { ...base, translated: false })
  })
})
