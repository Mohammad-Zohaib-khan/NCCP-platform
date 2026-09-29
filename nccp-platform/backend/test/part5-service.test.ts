import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { AppError } from '../src/lib/errors.js'
import type { AuthContext } from '../src/auth/context.js'
import type { Db } from '../src/db/pool.js'
import { createCertificatesService } from '../src/modules/certificates/certificates.service.js'
import { shapeCertificate, toPublicVerification, type CertificateRecord } from '../src/modules/certificates/certificates.dto.js'
import { generateVerificationCode } from '../src/modules/certificates/certificates.rules.js'

const INFO = { ip: '127.0.0.1', userAgent: 'test', requestId: 'req-1' }
const ids = { enrol: '11111111-1111-4111-8111-111111111111', batch: '22222222-2222-4222-8222-222222222222', inst: '33333333-3333-4333-8333-333333333333', otherInst: '44444444-4444-4444-8444-444444444444',
  prog: '55555555-5555-4555-8555-555555555555', trainee: '66666666-6666-4666-8666-666666666666', traineeUser: '77777777-7777-4777-8777-777777777777', trainerUser: '88888888-8888-4888-8888-888888888888',
  cert: '99999999-9999-4999-8999-999999999999', admin: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', employer: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
const actor = (role: AuthContext['role'], o: Partial<AuthContext> = {}): AuthContext => ({ userId: ids.admin, role, sessionId: 's', fullName: 'X', email: 'x@example.org', institutionIds: [ids.inst], employerIds: [], mfaEnabled: true, mfaSetupRequired: false, ...o })

interface World {
  enrolment?: Record<string, unknown> | null
  live?: boolean
  settings?: Record<string, unknown>
  inputs?: Record<string, number>
  insertFailures?: Array<{ code: string; constraint: string }>
  cert?: Record<string, unknown> | null
  certLock?: Record<string, unknown> | null
  publicRow?: Record<string, unknown> | null
}
const goodEnrolment = { id: ids.enrol, status: 'in_progress', final_score: 82.5, batch_id: ids.batch, batch_code: 'B-1', institution_id: ids.inst, programme_id: ids.prog, programme_title: 'Solar Technician',
  trainee_id: ids.trainee, trainee_user_id: ids.traineeUser, trainer_user_id: ids.trainerUser, trainee_name: 'Asha Kumari' }
const goodInputs = { counted: 10, present: 8, late: 0, excused: 0, total: 2, passed: 2 }
const certRow = (o: Record<string, unknown> = {}) => ({ id: ids.cert, certificate_no: 'NCCP-2026-ABCD2345', verification_code: 'ABCD-EFGH-JKMN-PQRS-TVWX', trainee_id: ids.trainee, enrolment_id: ids.enrol,
  programme_id: ids.prog, institution_id: ids.inst, title: 'Solar Technician', holder_name: 'Asha Kumari', grade: null, score: 82.5, status: 'issued', issued_at: new Date('2026-09-29T00:00:00Z'),
  revoked_at: null, revocation_reason: null, version: 1, ...o })

function fakeDb(w: World) {
  const log: string[] = []; const calls: Array<{ sql: string; params: unknown[] }> = []
  let failures = [...(w.insertFailures ?? [])]
  let issued = false
  const handler = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    const tag = sql.trim().split(/\s+/).slice(0, 3).join(' ')
    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(sql.trim())) { log.push(sql.trim()); return { rows: [] } }
    if (sql.includes('FROM batch_enrolments e JOIN batches b')) return { rows: w.enrolment === null ? [] : [w.enrolment ?? goodEnrolment] }
    if (sql.includes('FROM certificates WHERE enrolment_id')) return { rows: w.live ? [{ id: ids.cert }] : [] }
    if (sql.includes('FROM system_settings')) return { rows: Object.entries(w.settings ?? {}).map(([key, value]) => ({ key, value })) }
    if (sql.includes('WITH counted')) return { rows: [{ ...goodInputs, ...(w.inputs ?? {}) }] }
    if (sql.includes('INSERT INTO certificates')) {
      const f = failures.shift()
      if (f) { log.push('INSERT-FAILED'); throw Object.assign(new Error('duplicate key'), f) }
      issued = true; log.push('INSERT'); return { rows: [{ id: ids.cert }] }
    }
    if (sql.includes('INSERT INTO audit_logs')) { log.push('AUDIT'); return { rows: [] } }
    if (sql.includes('FROM certificates c JOIN batch_enrolments')) return { rows: (w.cert === null ? [] : issued || w.cert ? [w.cert ?? certRow()] : [certRow()]) }
    if (sql.includes('FROM certificates WHERE id = $1 FOR UPDATE')) return { rows: w.certLock === null ? [] : [w.certLock ?? { id: ids.cert, status: 'issued', institution_id: ids.inst, certificate_no: 'NCCP-2026-ABCD2345' }] }
    if (sql.includes('UPDATE certificates SET status')) { log.push('REVOKE-UPDATE'); return { rows: [] } }
    if (sql.includes('FROM certificates WHERE verification_code')) return { rows: w.publicRow === null ? [] : [w.publicRow ?? { certificate_no: 'NCCP-2026-ABCD2345', title: 'Solar Technician', holder_name: 'Asha Kumari', status: 'issued', issued_at: new Date('2026-09-29T10:00:00Z') }] }
    void tag
    return { rows: [] }
  }
  const client = { query: handler, release: () => undefined }
  const db = { query: handler, connect: async () => client } as unknown as Db
  return { db, log, calls }
}
const rejects = async (p: Promise<unknown>, status: number, code?: string) => assert.rejects(p, (e: unknown) => {
  assert.ok(e instanceof AppError, String(e)); assert.equal((e as AppError).statusCode, status)
  if (code) assert.equal(((e as AppError).details as { code?: string })?.code, code)
  return true
})

describe('issue', () => {
  test('eligible enrolment: locked read, insert, audit, all inside one transaction, in that order', async () => {
    const { db, log, calls } = fakeDb({})
    const dto = await createCertificatesService(db).issue(actor('institution_admin'), { enrolmentId: ids.enrol }, INFO)
    assert.deepEqual(log, ['BEGIN', 'SAVEPOINT cert_insert', 'INSERT', 'RELEASE SAVEPOINT cert_insert', 'AUDIT', 'COMMIT'])
    assert.equal(dto.certificateNo, 'NCCP-2026-ABCD2345')
    assert.match(calls.find((c) => c.sql.includes('FROM batch_enrolments e JOIN batches b'))!.sql, /FOR UPDATE OF e/)
    const insert = calls.find((c) => c.sql.includes('INSERT INTO certificates'))!
    assert.equal(insert.params[6], 'Solar Technician'); assert.equal(insert.params[7], 'Asha Kumari'); assert.equal(insert.params[8], 82.5); assert.equal(insert.params[9], ids.admin)
    assert.match(String(insert.params[0]), /^NCCP-\d{4}-/); assert.match(String(insert.params[1]), /^([0-9A-Z]{4}-){4}[0-9A-Z]{4}$/)
  })
  test('the audit row never carries the verification code', async () => {
    const { db, calls } = fakeDb({})
    await createCertificatesService(db).issue(actor('super_admin'), { enrolmentId: ids.enrol }, INFO)
    const audit = calls.find((c) => c.sql.includes('INSERT INTO audit_logs'))!
    assert.equal(audit.params[2], 'certificate.issue')
    const insert = calls.find((c) => c.sql.includes('INSERT INTO certificates'))!
    assert.ok(!JSON.stringify(audit.params).includes(String(insert.params[1])))
  })
  test('ineligible: 409 NOT_ELIGIBLE with every reason, nothing inserted, transaction rolled back', async () => {
    const { db, log } = fakeDb({ inputs: { present: 2, passed: 0 } })
    await assert.rejects(createCertificatesService(db).issue(actor('institution_admin'), { enrolmentId: ids.enrol }, INFO), (e: unknown) => {
      const err = e as AppError; assert.equal(err.statusCode, 409)
      const d = err.details as { code: string; reasons: Array<{ code: string }> }
      assert.equal(d.code, 'NOT_ELIGIBLE'); assert.deepEqual(d.reasons.map((r) => r.code), ['ATTENDANCE_BELOW_THRESHOLD', 'ASSESSMENTS_NOT_PASSED']); return true
    })
    assert.ok(!log.includes('INSERT')); assert.ok(log.includes('ROLLBACK')); assert.ok(!log.includes('COMMIT'))
  })
  test('threshold change through system_settings is honoured', async () => {
    const low = { present: 6, counted: 10 }
    await rejects(createCertificatesService(fakeDb({ inputs: low }).db).issue(actor('super_admin'), { enrolmentId: ids.enrol }, INFO), 409, 'NOT_ELIGIBLE')
    const ok = await createCertificatesService(fakeDb({ inputs: low, settings: { 'certificates.min_attendance_percent': 60 } }).db).issue(actor('super_admin'), { enrolmentId: ids.enrol }, INFO)
    assert.equal(ok.status, 'issued')
  })
  test('a dropped enrolment is refused', async () => {
    await rejects(createCertificatesService(fakeDb({ enrolment: { ...goodEnrolment, status: 'dropped' } }).db).issue(actor('super_admin'), { enrolmentId: ids.enrol }, INFO), 409, 'NOT_ELIGIBLE')
  })
  test('a second certificate for the same enrolment is 409 CERTIFICATE_EXISTS', async () => {
    const { db, log } = fakeDb({ live: true })
    await rejects(createCertificatesService(db).issue(actor('super_admin'), { enrolmentId: ids.enrol }, INFO), 409, 'CERTIFICATE_EXISTS')
    assert.ok(!log.includes('INSERT'))
  })
  test('the unique index is the backstop when a concurrent issue slips past the check', async () => {
    const { db, log } = fakeDb({ insertFailures: [{ code: '23505', constraint: 'certificates_one_live_per_enrolment' }] })
    await rejects(createCertificatesService(db).issue(actor('super_admin'), { enrolmentId: ids.enrol }, INFO), 409, 'CERTIFICATE_EXISTS')
    assert.ok(log.includes('ROLLBACK') && !log.includes('COMMIT'))
  })
  test('a certificate-number or code collision rolls back to the savepoint and retries', async () => {
    const { db, log } = fakeDb({ insertFailures: [{ code: '23505', constraint: 'certificates_certificate_no_key' }, { code: '23505', constraint: 'certificates_verification_code_key' }] })
    const dto = await createCertificatesService(db).issue(actor('super_admin'), { enrolmentId: ids.enrol }, INFO)
    assert.equal(dto.status, 'issued')
    assert.equal(log.filter((l) => l === 'ROLLBACK TO SAVEPOINT cert_insert').length, 2)
    assert.equal(log.at(-1), 'COMMIT')
  })
  test('repeated collisions give up with 503 rather than looping forever', async () => {
    const f = { code: '23505', constraint: 'certificates_certificate_no_key' }
    await rejects(createCertificatesService(fakeDb({ insertFailures: [f, f, f, f, f] }).db).issue(actor('super_admin'), { enrolmentId: ids.enrol }, INFO), 503)
  })
  test('an unrelated database error is not swallowed', async () => {
    await assert.rejects(createCertificatesService(fakeDb({ insertFailures: [{ code: '23514', constraint: 'whatever' }] }).db).issue(actor('super_admin'), { enrolmentId: ids.enrol }, INFO), /duplicate key/)
  })
  test('scope: unknown, other-institution, trainer and employer callers all get 404, never 403', async () => {
    const svc = (w: World) => createCertificatesService(fakeDb(w).db)
    await rejects(svc({ enrolment: null }).issue(actor('super_admin'), { enrolmentId: ids.enrol }, INFO), 404)
    await rejects(svc({}).issue(actor('institution_admin', { institutionIds: [ids.otherInst] }), { enrolmentId: ids.enrol }, INFO), 404)
    await rejects(svc({}).issue(actor('trainer', { userId: '00000000-0000-4000-8000-000000000000' }), { enrolmentId: ids.enrol }, INFO), 404)
    await rejects(svc({}).issue(actor('employer', { employerIds: [ids.employer] }), { enrolmentId: ids.enrol }, INFO), 404)
  })
})

describe('eligibility check', () => {
  test('trainee can check their own enrolment, not someone else\'s', async () => {
    const svc = createCertificatesService(fakeDb({}).db)
    const own = await svc.eligibility(actor('trainee', { userId: ids.traineeUser }), ids.enrol)
    assert.equal(own.eligible, true); assert.equal(own.alreadyIssued, false); assert.equal(own.attendancePercent, 80)
    await rejects(svc.eligibility(actor('trainee', { userId: '00000000-0000-4000-8000-000000000001' }), ids.enrol), 404)
  })
  test('reports alreadyIssued', async () => {
    assert.equal((await createCertificatesService(fakeDb({ live: true }).db).eligibility(actor('super_admin'), ids.enrol)).alreadyIssued, true)
  })
})

describe('revoke', () => {
  test('revokes with a reason and audits it', async () => {
    const { db, log, calls } = fakeDb({ cert: certRow({ status: 'revoked', revoked_at: new Date(), revocation_reason: 'Issued in error' }) })
    const dto = await createCertificatesService(db).revoke(actor('super_admin'), ids.cert, { reason: 'Issued in error' }, INFO)
    assert.equal(dto.status, 'revoked'); assert.equal(dto.revocationReason, 'Issued in error')
    assert.deepEqual(log, ['BEGIN', 'REVOKE-UPDATE', 'AUDIT', 'COMMIT'])
    const upd = calls.find((c) => c.sql.includes('UPDATE certificates SET status'))!
    assert.deepEqual(upd.params, [ids.cert, ids.admin, 'Issued in error'])
    assert.equal(calls.find((c) => c.sql.includes('INSERT INTO audit_logs'))!.params[2], 'certificate.revoke')
  })
  test('already revoked is 409, unknown is 404', async () => {
    await rejects(createCertificatesService(fakeDb({ certLock: { id: ids.cert, status: 'revoked', institution_id: ids.inst, certificate_no: 'N' } }).db).revoke(actor('super_admin'), ids.cert, { reason: 'again' }, INFO), 409, 'ALREADY_REVOKED')
    await rejects(createCertificatesService(fakeDb({ certLock: null }).db).revoke(actor('super_admin'), ids.cert, { reason: 'x y z' }, INFO), 404)
  })
  test('institution scope is still asserted even though only super admin holds the permission', async () => {
    await rejects(createCertificatesService(fakeDb({}).db).revoke(actor('institution_admin', { institutionIds: [ids.otherInst] }), ids.cert, { reason: 'nope' }, INFO), 404)
  })
})

describe('public verification', () => {
  const pub = (w: World, code = 'abcd-efgh-jkmn-pqrs-tvwx') => createCertificatesService(fakeDb(w).db).verifyPublic(code)
  test('valid certificate returns only the minimal fields', async () => {
    const r = await pub({})
    assert.deepEqual(Object.keys(r).sort(), ['certificateNo', 'holderName', 'issuedOn', 'programmeTitle', 'status', 'valid'])
    assert.deepEqual(r, { valid: true, status: 'issued', certificateNo: 'NCCP-2026-ABCD2345', programmeTitle: 'Solar Technician', issuedOn: '2026-09-29', holderName: 'Asha Kumari' })
  })
  test('the query selects only public columns', async () => {
    const { db, calls } = fakeDb({})
    await createCertificatesService(db).verifyPublic('ABCD-EFGH-JKMN-PQRS-TVWX')
    const sql = calls.find((c) => c.sql.includes('FROM certificates WHERE verification_code'))!.sql
    for (const secret of ['email', 'phone', 'score', 'trainee_id', 'institution', 'revocation_reason', 'users']) assert.ok(!sql.includes(secret), secret)
  })
  test('revoked certificate fails verification but still exposes nothing extra', async () => {
    const r = await pub({ publicRow: { certificate_no: 'N-1', title: 'T', holder_name: 'Asha Kumari', status: 'revoked', issued_at: new Date('2026-01-02T00:00:00Z') } })
    assert.equal(r.valid, false); assert.equal(r.status, 'revoked'); assert.ok(!('revocationReason' in r) && !('revokedAt' in r))
  })
  test('holder name follows the setting: initials and none', async () => {
    assert.equal((await pub({ settings: { 'certificates.public_holder_name': 'initials' } })).holderName, 'A. K.')
    const none = await pub({ settings: { 'certificates.public_holder_name': 'none' } })
    assert.equal(none.holderName, null); assert.ok(!JSON.stringify(none).includes('Asha'))
  })
  test('malformed codes are 404 without touching the database', async () => {
    for (const bad of ['', 'nope', 'ABCD-EFGH', "' OR 1=1 --", 'x'.repeat(64)]) {
      const { db, calls } = fakeDb({})
      await rejects(createCertificatesService(db).verifyPublic(bad), 404)
      assert.equal(calls.length, 0, bad)
    }
  })
  test('unknown well-formed code is the same 404', async () => {
    await rejects(pub({ publicRow: null }, generateVerificationCode()), 404)
  })
})

describe('list visibility', () => {
  const sortDef = { key: 'issued_at', expr: 'c.issued_at', type: 'timestamptz' as const, dir: 'DESC' as const }
  const run = async (a: AuthContext, f: Record<string, string> = {}) => {
    const { db, calls } = fakeDb({}); await createCertificatesService(db).list(a, f, sortDef, { limit: 25 }); return calls.at(-1)!
  }
  test('super admin unrestricted; institution admin by institution list; trainee by own user; trainer by own batches', async () => {
    assert.match((await run(actor('super_admin'))).sql, /WHERE TRUE/)
    const ia = await run(actor('institution_admin')); assert.match(ia.sql, /c\.institution_id = ANY\(\$1::uuid\[\]\)/); assert.deepEqual(ia.params[0], [ids.inst])
    const tn = await run(actor('trainee', { userId: ids.traineeUser })); assert.match(tn.sql, /t\.user_id = \$1/); assert.equal(tn.params[0], ids.traineeUser)
    const tr = await run(actor('trainer', { userId: ids.trainerUser })); assert.match(tr.sql, /tr\.user_id = \$1/); assert.equal(tr.params[0], ids.trainerUser)
  })
  test('employer sees only holders who applied to one of their jobs (withdrawn does not count)', async () => {
    const c = await run(actor('employer', { employerIds: [ids.employer] }))
    assert.match(c.sql, /FROM applications a JOIN jobs j/); assert.match(c.sql, /a\.status <> 'withdrawn'/); assert.deepEqual(c.params[0], [ids.employer])
  })
  test('an unknown role sees nothing', async () => { assert.match((await run(actor('nobody' as AuthContext['role']))).sql, /WHERE FALSE/) })
  test('institution filter outside the caller\'s scope is 404, not an empty page', async () => {
    const { db } = fakeDb({})
    await rejects(createCertificatesService(db).list(actor('institution_admin'), { institutionId: ids.otherInst }, sortDef, { limit: 25 }), 404)
  })
  test('user text is bound as a parameter, never spliced into SQL', async () => {
    const c = await run(actor('super_admin'), { q: "x'; DROP TABLE certificates;--" })
    assert.ok(!c.sql.includes('DROP TABLE')); assert.ok(c.params.some((p) => String(p).includes('DROP TABLE')))
  })
})

describe('role shaping', () => {
  const rec: CertificateRecord = { id: ids.cert, certificateNo: 'N', verificationCode: 'C', traineeId: ids.trainee, enrolmentId: ids.enrol, programmeId: ids.prog, institutionId: ids.inst,
    title: 'T', holderName: 'H', grade: 'A', score: 90, status: 'revoked', issuedAt: new Date(), revokedAt: new Date(), revocationReason: 'internal note', version: 2 }
  test('revocation reason is admin only', () => {
    for (const r of ['super_admin', 'institution_admin'] as const) assert.equal(shapeCertificate(rec, r).revocationReason, 'internal note')
    for (const r of ['trainer', 'trainee', 'employer'] as const) assert.equal(shapeCertificate(rec, r).revocationReason, null)
  })
  test('employers do not see score or grade', () => {
    const e = shapeCertificate(rec, 'employer'); assert.equal(e.score, null); assert.equal(e.grade, null)
    assert.equal(shapeCertificate(rec, 'trainee').score, 90)
  })
  test('public shape has no id fields', () => {
    const p = toPublicVerification({ status: 'issued', certificateNo: 'N', title: 'T', issuedAt: new Date('2026-03-04T23:59:59Z'), holderName: null })
    assert.deepEqual(Object.keys(p).sort(), ['certificateNo', 'holderName', 'issuedOn', 'programmeTitle', 'status', 'valid']); assert.equal(p.issuedOn, '2026-03-04')
  })
})
