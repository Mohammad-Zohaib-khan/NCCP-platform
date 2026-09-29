import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CERTIFICATE_NO_RE, CODE_ALPHABET, DEFAULT_CERTIFICATE_SETTINGS, SETTING_KEYS, evaluateEligibility, generateCertificateNo, generateVerificationCode,
  initialsOf, isWinAnsiPrintable, normaliseVerificationCode, parseCertificateSettings, publicHolderName, type CertificateSettings,
} from '../src/modules/certificates/certificates.rules.js'

const S = (o: Partial<CertificateSettings> = {}): CertificateSettings => ({ ...DEFAULT_CERTIFICATE_SETTINGS, ...o })
const counts = (present: number, late = 0, excused = 0, counted = present + late + excused) => ({ present, late, absent: 0, excused, counted })
const input = (o: { status?: string; att?: ReturnType<typeof counts>; total?: number; passed?: number } = {}) => ({
  enrolmentStatus: o.status ?? 'in_progress', attendance: o.att ?? counts(8, 0, 0, 10), assessments: { total: o.total ?? 2, passed: o.passed ?? 2 },
})

describe('certificate settings', () => {
  test('defaults are 75% attendance, assessments required, full name', () => {
    assert.deepEqual(parseCertificateSettings({}), { minAttendancePercent: 75, requireAssessmentsPassed: true, publicHolderName: 'full' })
  })
  test('valid stored values are used', () => {
    const s = parseCertificateSettings({ [SETTING_KEYS.minAttendancePercent]: 60, [SETTING_KEYS.requireAssessmentsPassed]: false, [SETTING_KEYS.publicHolderName]: 'initials' })
    assert.deepEqual(s, { minAttendancePercent: 60, requireAssessmentsPassed: false, publicHolderName: 'initials' })
  })
  test('malformed values fall back to the defaults instead of loosening a rule', () => {
    const s = parseCertificateSettings({ [SETTING_KEYS.minAttendancePercent]: '10', [SETTING_KEYS.requireAssessmentsPassed]: 'false', [SETTING_KEYS.publicHolderName]: 'everything' })
    assert.deepEqual(s, DEFAULT_CERTIFICATE_SETTINGS)
    assert.equal(parseCertificateSettings({ [SETTING_KEYS.minAttendancePercent]: 150 }).minAttendancePercent, 75)
    assert.equal(parseCertificateSettings({ [SETTING_KEYS.minAttendancePercent]: -1 }).minAttendancePercent, 75)
    assert.equal(parseCertificateSettings({ [SETTING_KEYS.minAttendancePercent]: Number.NaN }).minAttendancePercent, 75)
  })
})

describe('eligibility', () => {
  test('meets both thresholds -> eligible', () => {
    const r = evaluateEligibility(input(), S())
    assert.equal(r.eligible, true); assert.equal(r.attendancePercent, 80); assert.deepEqual(r.reasons, [])
  })
  test('exactly at the threshold is eligible; just below is not', () => {
    assert.equal(evaluateEligibility(input({ att: counts(75, 0, 0, 100) }), S()).eligible, true)
    const r = evaluateEligibility(input({ att: counts(74, 0, 0, 100) }), S())
    assert.equal(r.eligible, false); assert.equal(r.reasons[0]?.code, 'ATTENDANCE_BELOW_THRESHOLD')
  })
  test('late counts as attended and excused leaves the denominator (Part 4 formula)', () => {
    // 6 present + 2 late of 10 counted = 80%; 6 present, 2 absent, 2 excused: denominator is 8, so 6/8 = 75%
    assert.equal(evaluateEligibility(input({ att: counts(6, 2, 0, 10) }), S()).attendancePercent, 80)
    assert.equal(evaluateEligibility(input({ att: { present: 6, late: 0, absent: 2, excused: 2, counted: 10 } }), S()).attendancePercent, 75)
  })
  test('nothing countable yet (null percent) is never eligible', () => {
    const r = evaluateEligibility(input({ att: counts(0, 0, 0, 0) }), S({ minAttendancePercent: 0 }))
    assert.equal(r.attendancePercent, null); assert.equal(r.eligible, false); assert.equal(r.reasons[0]?.code, 'ATTENDANCE_NOT_COUNTABLE')
    const allExcused = evaluateEligibility(input({ att: { present: 0, late: 0, absent: 0, excused: 3, counted: 3 } }), S({ minAttendancePercent: 0 }))
    assert.equal(allExcused.eligible, false)
  })
  test('a failed or missing assessment blocks; zero assessments block while required', () => {
    assert.equal(evaluateEligibility(input({ total: 3, passed: 2 }), S()).reasons[0]?.code, 'ASSESSMENTS_NOT_PASSED')
    assert.equal(evaluateEligibility(input({ total: 0, passed: 0 }), S()).reasons[0]?.code, 'NO_ASSESSMENTS')
  })
  test('assessment rule can be switched off through settings', () => {
    assert.equal(evaluateEligibility(input({ total: 3, passed: 0 }), S({ requireAssessmentsPassed: false })).eligible, true)
    assert.equal(evaluateEligibility(input({ total: 0, passed: 0 }), S({ requireAssessmentsPassed: false })).eligible, true)
  })
  test('threshold change through settings changes the outcome', () => {
    const i = input({ att: counts(60, 0, 0, 100) })
    assert.equal(evaluateEligibility(i, S()).eligible, false)
    assert.equal(evaluateEligibility(i, S({ minAttendancePercent: 60 })).eligible, true)
  })
  test('only seat-holding enrolments can be certified', () => {
    for (const s of ['enrolled', 'in_progress', 'completed']) assert.equal(evaluateEligibility(input({ status: s }), S()).eligible, true, s)
    for (const s of ['applied', 'dropped', 'rejected']) assert.equal(evaluateEligibility(input({ status: s }), S()).reasons[0]?.code, 'ENROLMENT_STATUS', s)
  })
  test('every reason is reported, not only the first', () => {
    const r = evaluateEligibility(input({ status: 'dropped', att: counts(1, 0, 0, 10), total: 2, passed: 0 }), S())
    assert.deepEqual(r.reasons.map((x) => x.code), ['ENROLMENT_STATUS', 'ATTENDANCE_BELOW_THRESHOLD', 'ASSESSMENTS_NOT_PASSED'])
  })
})

describe('identifiers', () => {
  test('certificate number is readable and well formed', () => {
    for (let i = 0; i < 200; i++) assert.match(generateCertificateNo(new Date(Date.UTC(2026, 8, 29))), CERTIFICATE_NO_RE)
    assert.match(generateCertificateNo(new Date(Date.UTC(2026, 8, 29))), /^NCCP-2026-/)
  })
  test('verification codes are 100-bit, grouped, from the safe alphabet, and do not repeat', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) {
      const c = generateVerificationCode()
      assert.match(c, /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/)
      assert.equal(normaliseVerificationCode(c), c)
      seen.add(c)
    }
    assert.equal(seen.size, 2000)
  })
  test('the alphabet has 32 unambiguous characters', () => {
    assert.equal(CODE_ALPHABET.length, 32); assert.equal(new Set(CODE_ALPHABET).size, 32)
    for (const bad of 'ILOU') assert.ok(!CODE_ALPHABET.includes(bad), bad)
  })
  test('character distribution is not wildly skewed (no modulo bias smell)', () => {
    const counts: Record<string, number> = {}
    for (let i = 0; i < 4000; i++) for (const ch of generateVerificationCode().replace(/-/g, '')) counts[ch] = (counts[ch] ?? 0) + 1
    const values = Object.values(counts); const mean = 80_000 / 32
    assert.equal(values.length, 32)
    for (const v of values) assert.ok(v > mean * 0.9 && v < mean * 1.1, `count ${v} vs mean ${mean}`)
  })
  test('normalisation accepts lowercase, spaces, missing dashes and look-alikes', () => {
    assert.equal(normaliseVerificationCode('abcd efgh jkmn pqrs tvwx'), 'ABCD-EFGH-JKMN-PQRS-TVWX')
    assert.equal(normaliseVerificationCode('ABCDEFGHJKMNPQRSTVWX'), 'ABCD-EFGH-JKMN-PQRS-TVWX')
    assert.equal(normaliseVerificationCode('O1IL-0000-0000-0000-0000'), '0111-0000-0000-0000-0000')
  })
  test('anything that cannot be a code is rejected without a database lookup', () => {
    for (const bad of ['', 'short', 'ABCD-EFGH-JKMN-PQRS-TVWXY', 'ABCD-EFGH-JKMN-PQRS-TVW!', 'ABCD-EFGH-JKMN-PQRS-TVWU', 'x'.repeat(100), "'; DROP TABLE certificates;--", 'ABCD-EFGH-JKMN-PQRS-TVW\u0301X']) {
      assert.equal(normaliseVerificationCode(bad), null, bad)
    }
    assert.equal(normaliseVerificationCode(undefined as unknown as string), null)
  })
})

describe('public holder name', () => {
  test('full, initials and none', () => {
    assert.equal(publicHolderName('Asha Kumari Devi', 'full'), 'Asha Kumari Devi')
    assert.equal(publicHolderName('Asha Kumari Devi', 'initials'), 'A. K. D.')
    assert.equal(publicHolderName('Asha Kumari Devi', 'none'), null)
  })
  test('initials handle extra spaces, lowercase and non-Latin scripts', () => {
    assert.equal(initialsOf('  ravi   shankar '), 'R. S.')
    assert.equal(initialsOf('आशा कुमारी'), 'आ. क.')
    assert.equal(initialsOf('   '), '')
    assert.equal(publicHolderName('   ', 'initials'), null)
    assert.equal(publicHolderName('   ', 'full'), null)
  })
  test('initials never contain the rest of the name', () => {
    assert.ok(!publicHolderName('Priyanka Sharma', 'initials')!.includes('riyanka'))
  })
})

describe('printable text for standard PDF fonts', () => {
  test('ASCII, Latin-1 and WinAnsi punctuation print', () => {
    for (const t of ['Asha Kumari', "O'Brien", 'José Müller', 'Programme – Level 2', '“Quoted” €5']) assert.equal(isWinAnsiPrintable(t), true, t)
  })
  test('Devanagari, other scripts, emoji and control characters do not', () => {
    for (const t of ['आशा कुमारी', 'Asha आ', '张伟', '😀', 'line\nbreak', 'tab\t', 'nul\u0000', 'Ł']) assert.equal(isWinAnsiPrintable(t), false, JSON.stringify(t))
  })
})
