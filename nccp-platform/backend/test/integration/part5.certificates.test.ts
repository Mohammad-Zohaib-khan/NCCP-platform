/**
 * Part 5 integration tests: eligibility, issue (including concurrent issue), revoke, role scope, public verification, PDF, rate limit.
 * Skipped unless RUN_DB_TESTS=1. NOT yet executed by the author (no PostgreSQL or npm registry in the build sandbox),
 * so expect small fixes on the first real run. Seeds through SQL; users log in through the real /auth/login.
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../../src/config/env.js'
import { createPool, type Db } from '../../src/db/pool.js'
import { buildApp } from '../../src/app.js'
import { hashPassword } from '../../src/auth/password.js'
import type { Mailer } from '../../src/lib/mailer.js'

const run = process.env.RUN_DB_TESTS === '1'
const PW = 'Tr4ining-Portal!'
const sfx = Math.random().toString(36).slice(2, 8)
const mailer: Mailer = { async send() { /* not needed */ } }
const email = (n: string) => `${n}.${sfx}@cert.example`
const CODE_RE = /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/

describe('Part 5: certificates and public verification (PostgreSQL)', { skip: !run }, () => {
  let app: FastifyInstance; let db: Db
  const id: Record<string, string> = {}; const tok: Record<string, string> = {}

  const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, who: string | null, payload?: unknown) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, payload: payload as never, headers: who ? { authorization: `Bearer ${tok[who]}` } : {} })
    let body: any = null; try { body = res.json() } catch { /* pdf / 204 */ }
    return { status: res.statusCode, body, headers: res.headers, raw: res.rawPayload }
  }
  async function seedUser(name: string, role: string, fullName = name) {
    id[name] = (await db.query<{ id: string }>(`INSERT INTO users (email, full_name, role_code, status, password_hash, email_verified_at) VALUES ($1,$2,$3,'active',$4, now()) RETURNING id`, [email(name), fullName, role, await hashPassword(PW)])).rows[0]!.id
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: email(name), password: PW } })
    assert.equal(res.statusCode, 200, `login ${name}`); tok[name] = res.json().accessToken
  }
  async function seedTrainee(name: string, inst: string, fullName = name) {
    await seedUser(name, 'trainee', fullName)
    id[`te_${name}`] = (await db.query<{ id: string }>(`INSERT INTO trainees (user_id, institution_id) VALUES ($1,$2) RETURNING id`, [id[name], id[inst]])).rows[0]!.id
  }
  const enrol = async (batch: string, name: string) => (await db.query<{ id: string }>(`INSERT INTO batch_enrolments (batch_id, trainee_id, status) VALUES ($1,$2,'enrolled') RETURNING id`, [id[batch], id[`te_${name}`]])).rows[0]!.id
  /** `present` of the batch's 4 finished sessions attended; `passed` decides the result of the batch's one published assessment (null = no result yet). */
  async function progress(batch: string, name: string, present: number, passed: boolean | null) {
    const sessions = (await db.query<{ id: string }>(`SELECT id FROM class_sessions WHERE batch_id = $1 ORDER BY starts_at`, [id[batch]])).rows
    for (let i = 0; i < sessions.length; i++) await db.query(`INSERT INTO attendance (session_id, trainee_id, status, method) VALUES ($1,$2,$3,'manual')`, [sessions[i]!.id, id[`te_${name}`], i < present ? 'present' : 'absent'])
    if (passed !== null) await db.query(`INSERT INTO assessment_results (assessment_id, trainee_id, attempt_no, score, passed, status, submitted_at, graded_at) VALUES ($1,$2,1,$3,$4,'graded', now(), now())`, [id[`as_${batch}`], id[`te_${name}`], passed ? 80 : 10, passed])
  }
  async function seedBatch(key: string, inst: string, trainer: string, programme: string) {
    id[key] = (await db.query<{ id: string }>(`INSERT INTO batches (code, programme_id, institution_id, trainer_id, start_date, end_date, capacity, status) VALUES ($1,$2,$3,$4,'2026-01-01','2027-12-31',20,'ongoing') RETURNING id`, [`C-${key}-${sfx}`.toUpperCase(), id[programme], id[inst], id[trainer]])).rows[0]!.id
    for (let i = 0; i < 4; i++) await db.query(`INSERT INTO class_sessions (batch_id, title, starts_at, ends_at, status) VALUES ($1,$2, now() - ($3 || ' days')::interval, now() - ($3 || ' days')::interval + interval '2 hours', 'completed')`, [id[key], `S${i}`, String(i + 2)])
    id[`as_${key}`] = (await db.query<{ id: string }>(`INSERT INTO assessments (batch_id, title, total_marks, pass_marks, status) VALUES ($1,'Final',100,40,'published') RETURNING id`, [id[key]])).rows[0]!.id
  }
  const issue = (who: string, name: string, enrolment?: string) => call('POST', '/certificates', who, { enrolmentId: enrolment ?? id[`en_${name}`] })
  const setSetting = (key: string, value: unknown) => db.query(`UPDATE system_settings SET value = $2::jsonb WHERE key = $1`, [key, JSON.stringify(value)])

  before(async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent', APP_BASE_URL: 'https://nccp.example.org' })
    db = createPool(config); app = await buildApp({ config, db, mailer })
    for (const k of ['A', 'B']) id[`inst${k}`] = (await db.query<{ id: string }>(`INSERT INTO institutions (name, status) VALUES ($1,'active') RETURNING id`, [`Cert Inst ${k} ${sfx}`])).rows[0]!.id
    await seedUser('root', 'super_admin'); await seedUser('adminA', 'institution_admin'); await seedUser('adminB', 'institution_admin')
    await seedUser('trainerA', 'trainer'); await seedUser('trainerB', 'trainer'); await seedUser('emp1', 'employer'); await seedUser('emp2', 'employer')
    for (const [a, i] of [['adminA', 'instA'], ['adminB', 'instB']] as const) await db.query(`INSERT INTO institution_users (institution_id, user_id, org_role) VALUES ($1,$2,'admin')`, [id[i], id[a]])
    for (const [n, inst] of [['trainerA', 'instA'], ['trainerB', 'instB']] as const) id[`tr_${n}`] = (await db.query<{ id: string }>(`INSERT INTO trainers (user_id, institution_id) VALUES ($1,$2) RETURNING id`, [id[n], id[inst]])).rows[0]!.id
    id.progA = (await db.query<{ id: string }>(`INSERT INTO programmes (title, status, institution_id) VALUES ($1,'active',$2) RETURNING id`, [`Solar Technician ${sfx}`, id.instA])).rows[0]!.id
    id.progB = (await db.query<{ id: string }>(`INSERT INTO programmes (title, status, institution_id) VALUES ($1,'active',$2) RETURNING id`, [`Other Programme ${sfx}`, id.instB])).rows[0]!.id
    await seedBatch('batchA', 'instA', 'tr_trainerA', 'progA'); await seedBatch('batchB', 'instB', 'tr_trainerB', 'progB')

    await seedTrainee('good', 'instA', 'Asha Kumari Devi'); await seedTrainee('race', 'instA', 'Ravi Race'); await seedTrainee('low', 'instA', 'Lata Low')
    await seedTrainee('failed', 'instA', 'Farid Failed'); await seedTrainee('none', 'instA', 'Nina NoResult'); await seedTrainee('hindi', 'instA', 'आशा कुमारी')
    await seedTrainee('dropped', 'instA', 'Dev Dropped'); await seedTrainee('other', 'instB', 'Olga Other'); await seedTrainee('peer', 'instA', 'Peer Peer')
    for (const n of ['good', 'race', 'low', 'failed', 'none', 'hindi', 'peer']) id[`en_${n}`] = await enrol('batchA', n)
    id.en_other = await enrol('batchB', 'other')
    id.en_dropped = (await db.query<{ id: string }>(`INSERT INTO batch_enrolments (batch_id, trainee_id, status) VALUES ($1,$2,'dropped') RETURNING id`, [id.batchA, id.te_dropped])).rows[0]!.id
    await progress('batchA', 'good', 4, true); await progress('batchA', 'race', 4, true); await progress('batchA', 'hindi', 4, true);
    await progress('batchA', 'low', 1, true)      // 25 % attendance
    await progress('batchA', 'failed', 4, false)  // graded but not passed
    await progress('batchA', 'none', 4, null)     // no result yet
    await progress('batchA', 'dropped', 4, true)
    await progress('batchB', 'other', 4, true)
  })
  after(async () => { await setSetting('certificates.min_attendance_percent', 75); await setSetting('certificates.public_holder_name', 'full'); await app.close(); await db.end() })

  test('permissions and scope: only admins issue; another institution and outsiders get 404', async () => {
    assert.equal((await issue('trainerA', 'good')).status, 403)
    assert.equal((await issue('good', 'good')).status, 403)
    assert.equal((await issue('emp1', 'good')).status, 403)
    assert.equal((await issue(null as never, 'good')).status, 401)
    assert.equal((await issue('adminB', 'good')).status, 404)                                  // other institution's enrolment
    assert.equal((await call('POST', '/certificates', 'adminA', { enrolmentId: '00000000-0000-4000-8000-000000000000' })).status, 404)
    assert.equal((await call('POST', '/certificates', 'adminA', { enrolmentId: id.en_good, extra: 1 })).status, 422)   // strict body
  })

  test('ineligible enrolments are 409 NOT_ELIGIBLE with reasons; nothing is written', async () => {
    const cases: Array<[string, string]> = [['low', 'ATTENDANCE_BELOW_THRESHOLD'], ['failed', 'ASSESSMENTS_NOT_PASSED'], ['none', 'ASSESSMENTS_NOT_PASSED'], ['dropped', 'ENROLMENT_STATUS']]
    for (const [name, code] of cases) {
      const r = await issue('adminA', name); assert.equal(r.status, 409, `${name}: ${JSON.stringify(r.body)}`)
      assert.equal(r.body.error.details.code, 'NOT_ELIGIBLE'); assert.ok(r.body.error.details.reasons.some((x: any) => x.code === code), `${name} should report ${code}`)
    }
    const n = (await db.query(`SELECT count(*)::int AS n FROM certificates c JOIN batch_enrolments e ON e.id = c.enrolment_id WHERE e.batch_id = $1`, [id.batchA])).rows[0]
    assert.equal(n.n, 0)
    const el = await call('GET', `/certificates/eligibility/${id.en_low}`, 'adminA'); assert.equal(el.status, 200); assert.equal(el.body.eligible, false); assert.equal(el.body.attendancePercent, 25)
    assert.equal((await call('GET', `/certificates/eligibility/${id.en_good}`, 'good')).body.eligible, true)
    assert.equal((await call('GET', `/certificates/eligibility/${id.en_good}`, 'peer')).status, 404)   // another trainee
    assert.equal((await call('GET', `/certificates/eligibility/${id.en_good}`, 'emp1')).status, 404)   // employers never
  })

  test('threshold comes from system_settings', async () => {
    try {
      await setSetting('certificates.min_attendance_percent', 20)
      const r = await issue('adminA', 'low'); assert.equal(r.status, 201, JSON.stringify(r.body))
      await call('POST', `/certificates/${r.body.id}/revoke`, 'root', { reason: 'Test cleanup' })
    } finally { await setSetting('certificates.min_attendance_percent', 75) }
    assert.equal((await issue('adminA', 'low')).status, 409)
  })

  let certId = ''; let code = ''; let certNo = ''
  test('eligible enrolment: 201, readable number and non-guessable code, audit row written', async () => {
    const r = await issue('adminA', 'good'); assert.equal(r.status, 201, JSON.stringify(r.body))
    certId = r.body.id; code = r.body.verificationCode; certNo = r.body.certificateNo
    assert.match(certNo, /^NCCP-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/); assert.match(code, CODE_RE)
    assert.equal(r.body.holderName, 'Asha Kumari Devi'); assert.equal(r.body.status, 'issued'); assert.equal(r.headers.etag, `"${r.body.version}"`)
    const audit = (await db.query(`SELECT changes FROM audit_logs WHERE action = 'certificate.issue' AND entity_id = $1`, [certId])).rows
    assert.equal(audit.length, 1); assert.ok(!JSON.stringify(audit[0]).includes(code), 'verification code must not be in the audit log')
    assert.equal((await issue('adminA', 'good')).body.error.details.code, 'CERTIFICATE_EXISTS')          // one live certificate per enrolment
  })

  test('concurrent issue: exactly one certificate is created', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => issue(['adminA', 'root'][Math.floor(Math.random() * 2)]!, 'race')))
    assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)))
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409))
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM certificates WHERE enrolment_id = $1 AND status = 'issued'`, [id.en_race])).rows[0].n, 1)
  })

  test('reads are role scoped: own trainee, own trainer, own institution, super admin; nobody else', async () => {
    for (const who of ['good', 'trainerA', 'adminA', 'root']) assert.equal((await call('GET', `/certificates/${certId}`, who)).status, 200, who)
    for (const who of ['peer', 'trainerB', 'adminB', 'emp1']) assert.equal((await call('GET', `/certificates/${certId}`, who)).status, 404, who)
    const mine = await call('GET', '/certificates', 'good'); assert.ok(mine.body.data.length >= 1 && mine.body.data.every((c: any) => c.traineeId === id.te_good))
    assert.equal((await call('GET', '/certificates', 'peer')).body.data.length, 0)
    assert.equal((await call('GET', '/certificates', 'adminB')).body.data.length, 0)
    assert.equal((await call('GET', `/certificates?institutionId=${id.instB}`, 'adminA')).status, 404)   // outside scope
    const search = await call('GET', `/certificates?q=${encodeURIComponent(certNo)}`, 'adminA'); assert.equal(search.body.data.length, 1)
    assert.equal((await call('GET', '/certificates?sort=bogus', 'root')).status, 422)
  })

  test('employers see a certificate only through a live application, and never the score', async () => {
    const employer = (await db.query<{ id: string }>(`INSERT INTO employers (name, verification_status) VALUES ($1,'verified') RETURNING id`, [`Coop Employer ${sfx}`])).rows[0]!.id
    await db.query(`INSERT INTO employer_users (employer_id, user_id) VALUES ($1,$2)`, [employer, id.emp1])
    const job = (await db.query<{ id: string }>(`INSERT INTO jobs (employer_id, title, status) VALUES ($1,'Installer','active') RETURNING id`, [employer])).rows[0]!.id
    // employer scope is resolved from the database per request, so no new login is needed
    assert.equal((await call('GET', `/certificates/${certId}`, 'emp1')).status, 404)                      // no application yet
    const app1 = (await db.query<{ id: string }>(`INSERT INTO applications (job_id, trainee_id) VALUES ($1,$2) RETURNING id`, [job, id.te_good])).rows[0]!.id
    const seen = await call('GET', `/certificates/${certId}`, 'emp1'); assert.equal(seen.status, 200); assert.equal(seen.body.score, null); assert.equal(seen.body.grade, null); assert.equal(seen.body.revocationReason, null)
    assert.equal((await call('GET', `/certificates/${certId}`, 'emp2')).status, 404)                      // a different employer
    await db.query(`UPDATE applications SET status = 'withdrawn' WHERE id = $1`, [app1])
    assert.equal((await call('GET', `/certificates/${certId}`, 'emp1')).status, 404)                      // withdrawn no longer grants access
  })

  test('public verification: minimal fields, same 404 for unknown and malformed, tolerant of typing', async () => {
    const ok = await call('GET', `/verify/${code}`, null); assert.equal(ok.status, 200)
    assert.deepEqual(Object.keys(ok.body).sort(), ['certificateNo', 'holderName', 'issuedOn', 'programmeTitle', 'status', 'valid'])
    assert.equal(ok.body.valid, true); assert.equal(ok.body.holderName, 'Asha Kumari Devi'); assert.equal(ok.body.certificateNo, certNo)
    const text = JSON.stringify(ok.body); for (const leak of [email('good'), id.good!, id.te_good!, id.instA!, 'score', 'phone']) assert.ok(!text.includes(leak), `leaked ${leak}`)
    assert.equal(ok.headers['cache-control'], 'no-store'); assert.equal(ok.headers['x-robots-tag'], 'noindex')
    assert.equal((await call('GET', `/verify/${code.toLowerCase().replaceAll('-', ' ')}`, null)).status, 200)   // lowercase, spaces
    const unknown = await call('GET', '/verify/ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ', null); const malformed = await call('GET', '/verify/not-a-code', null)
    assert.equal(unknown.status, 404); assert.equal(malformed.status, 404)
    assert.deepEqual({ ...unknown.body, error: { ...unknown.body.error, requestId: 'x' } }, { ...malformed.body, error: { ...malformed.body.error, requestId: 'x' } })
    assert.equal((await call('GET', `/verify/${'A'.repeat(200)}`, null)).status, 422)                          // param length cap
  })

  test('public holder name follows the setting (initials, none)', async () => {
    try {
      await setSetting('certificates.public_holder_name', 'initials'); assert.equal((await call('GET', `/verify/${code}`, null)).body.holderName, 'A. K. D.')
      await setSetting('certificates.public_holder_name', 'none'); assert.equal((await call('GET', `/verify/${code}`, null)).body.holderName, null)
    } finally { await setSetting('certificates.public_holder_name', 'full') }
  })

  test('PDF: owner and staff get a real PDF; others 404; Devanagari holder is a clear 409', async () => {
    const pdf = await call('GET', `/certificates/${certId}/pdf`, 'good'); assert.equal(pdf.status, 200)
    assert.equal(pdf.headers['content-type'], 'application/pdf'); assert.match(String(pdf.headers['content-disposition']), new RegExp(`attachment; filename="${certNo}\\.pdf"`))
    assert.equal(pdf.headers['cache-control'], 'private, no-store'); assert.ok(pdf.raw.subarray(0, 5).toString() === '%PDF-'); assert.ok(pdf.raw.length > 5000)
    assert.ok(pdf.raw.toString('latin1').includes('https://nccp.example.org/verify/' + code))
    assert.equal((await call('GET', `/certificates/${certId}/pdf`, 'adminA')).status, 200)
    for (const who of ['peer', 'adminB', 'trainerB', 'emp2']) assert.equal((await call('GET', `/certificates/${certId}/pdf`, who)).status, 404, who)
    assert.equal((await call('GET', `/certificates/${certId}/pdf`, null)).status, 401)
    const h = await issue('root', 'hindi'); assert.equal(h.status, 201)                                          // issuing is fine; only printing needs a Unicode font
    const hp = await call('GET', `/certificates/${h.body.id}/pdf`, 'root'); assert.equal(hp.status, 409); assert.equal(hp.body.error.details.code, 'UNSUPPORTED_CHARACTERS')
  })

  test('revoke: super admin only, reason required, once; then verification fails and the PDF is refused', async () => {
    assert.equal((await call('POST', `/certificates/${certId}/revoke`, 'adminA', { reason: 'nope' })).status, 403)
    assert.equal((await call('POST', `/certificates/${certId}/revoke`, 'root', {})).status, 422)
    assert.equal((await call('POST', `/certificates/${certId}/revoke`, 'root', { reason: 'ab' })).status, 422)
    const r = await call('POST', `/certificates/${certId}/revoke`, 'root', { reason: 'Issued in error' }); assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.status, 'revoked'); assert.equal(r.body.revocationReason, 'Issued in error')
    assert.equal((await call('POST', `/certificates/${certId}/revoke`, 'root', { reason: 'again please' })).body.error.details.code, 'ALREADY_REVOKED')
    const v = await call('GET', `/verify/${code}`, null); assert.equal(v.status, 200); assert.equal(v.body.valid, false); assert.equal(v.body.status, 'revoked')
    assert.ok(!JSON.stringify(v.body).includes('Issued in error'), 'reason is internal')
    assert.equal((await call('GET', `/certificates/${certId}`, 'good')).body.revocationReason, null)              // trainee never sees the note
    assert.equal((await call('GET', `/certificates/${certId}`, 'adminA')).body.revocationReason, 'Issued in error')
    assert.equal((await call('GET', `/certificates/${certId}/pdf`, 'good')).body.error.details.code, 'CERTIFICATE_REVOKED')
    const audit = (await db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'certificate.revoke' AND entity_id = $1`, [certId])).rows[0]; assert.equal(audit.n, 1)
    // after revocation a new certificate can be issued for the same enrolment (the unique index only covers live ones)
    const again = await issue('adminA', 'good'); assert.equal(again.status, 201); assert.notEqual(again.body.certificateNo, certNo); assert.notEqual(again.body.verificationCode, code)
  })

  test('database guard: identity fields are immutable and a revoked certificate cannot be revived', async () => {
    await assert.rejects(db.query(`UPDATE certificates SET holder_name = 'Someone Else' WHERE id = $1`, [certId]), /immutable/)
    await assert.rejects(db.query(`UPDATE certificates SET verification_code = 'AAAA-AAAA-AAAA-AAAA-AAAA' WHERE id = $1`, [certId]), /immutable/)
    await assert.rejects(db.query(`UPDATE certificates SET status = 'issued', revoked_at = NULL, revocation_reason = NULL WHERE id = $1`, [certId]), /reinstated/)
  })

  test('/verify is tightly rate limited per IP (a non-test app, because tests disable limits)', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'development', LOG_LEVEL: 'silent', RATE_LIMIT_MAX: '1000' })
    const limited = await buildApp({ config, db, mailer })
    try {
      const statuses: number[] = []
      for (let i = 0; i < 25; i++) statuses.push((await limited.inject({ method: 'GET', url: '/api/v1/verify/ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' })).statusCode)
      assert.equal(statuses.filter((s) => s === 404).length, 20); assert.equal(statuses.filter((s) => s === 429).length, 5)
      const blocked = await limited.inject({ method: 'GET', url: '/api/v1/verify/ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' }); assert.equal(blocked.json().error.code, 'RATE_LIMITED')
    } finally { await limited.close() }
  })
})
