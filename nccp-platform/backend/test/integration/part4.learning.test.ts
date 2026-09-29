/**
 * Part 4 integration tests: enrolments, LMS, sessions, attendance, assessments against a real PostgreSQL with all
 * migrations applied. Skipped unless RUN_DB_TESTS=1 (CI sets it). NOT yet executed by the author: the build sandbox had
 * no PostgreSQL or npm registry access, so expect to fix small issues on the first real run.
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
const mailer: Mailer = { async send() { /* not needed here */ } }
const email = (n: string) => `${n}.${sfx}@test.example`
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()
const H = 3_600_000

describe('Part 4: enrolments, LMS, sessions, attendance, assessments (PostgreSQL)', { skip: !run }, () => {
  let app: FastifyInstance; let db: Db
  const id: Record<string, string> = {}
  const tok: Record<string, string> = {}

  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, who: string | null, payload?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, payload: payload as never, headers: { ...(who ? { authorization: `Bearer ${tok[who]}` } : {}), ...headers } })
    let body: any = null; try { body = res.json() } catch { /* 204 */ }
    return { status: res.statusCode, body, etag: res.headers.etag as string | undefined }
  }
  const ver = (etag?: string) => ({ 'if-match': etag ?? '"1"' })
  async function seedUser(name: string, role: string) {
    id[name] = (await db.query<{ id: string }>(`INSERT INTO users (email, full_name, role_code, status, password_hash, email_verified_at) VALUES ($1,$2,$3,'active',$4, now()) RETURNING id`, [email(name), name, role, await hashPassword(PW)])).rows[0]!.id
  }
  async function seedTrainee(name: string, inst: string, login = false) {
    await seedUser(name, 'trainee')
    id[`te_${name}`] = (await db.query<{ id: string }>(`INSERT INTO trainees (user_id, institution_id) VALUES ($1,$2) RETURNING id`, [id[name], id[inst]])).rows[0]!.id
    if (login) await doLogin(name)
  }
  async function doLogin(name: string) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: email(name), password: PW } })
    assert.equal(res.statusCode, 200, `login ${name}`)
    tok[name] = res.json().accessToken
  }
  /** An ongoing batch in institution A with trainer A1 (unless overridden). */
  async function newBatch(code: string, capacity = 10, extra: Record<string, unknown> = {}) {
    const r = await call('POST', '/batches', 'adminA', { code: `${code}-${sfx}`.slice(0, 29).toUpperCase(), programmeId: id.progA, institutionId: id.instA, trainerId: id.tr_trainerA1, startDate: '2026-11-01', endDate: '2027-01-31', capacity, ...extra })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const s = await call('POST', `/batches/${r.body.id}/status`, 'adminA', { status: 'ongoing' })
    assert.equal(s.status, 200, JSON.stringify(s.body))
    return r.body.id as string
  }
  const enrol = (who: string, batchId: string, trainee: string) => call('POST', '/enrolments', who, { batchId, traineeId: id[`te_${trainee}`] })

  before(async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' })
    db = createPool(config); app = await buildApp({ config, db, mailer })
    for (const [k, status] of [['A', 'active'], ['B', 'active'], ['S', 'suspended']] as const)
      id[`inst${k}`] = (await db.query<{ id: string }>(`INSERT INTO institutions (name, status) VALUES ($1,$2) RETURNING id`, [`P4 Inst ${k} ${sfx}`, status])).rows[0]!.id
    await seedUser('root', 'super_admin'); await seedUser('adminA', 'institution_admin'); await seedUser('adminB', 'institution_admin')
    await seedUser('trainerA1', 'trainer'); await seedUser('trainerA2', 'trainer'); await seedUser('trainerB', 'trainer')
    await db.query(`INSERT INTO institution_users (institution_id, user_id, org_role) VALUES ($1,$2,'admin'),($3,$4,'admin')`, [id.instA, id.adminA, id.instB, id.adminB])
    for (const [n, inst] of [['trainerA1', 'instA'], ['trainerA2', 'instA'], ['trainerB', 'instB']] as const)
      id[`tr_${n}`] = (await db.query<{ id: string }>(`INSERT INTO trainers (user_id, institution_id) VALUES ($1,$2) RETURNING id`, [id[n], id[inst]])).rows[0]!.id
    for (const n of ['t1', 't2', 't3', 't4', 't5', 't6']) await seedTrainee(n, 'instA', n === 't1' || n === 't2' || n === 't3')
    await seedTrainee('tB', 'instB', true)
    id.progA = (await db.query<{ id: string }>(`INSERT INTO programmes (title, status, institution_id) VALUES ($1,'active',$2) RETURNING id`, [`P4 Programme A ${sfx}`, id.instA])).rows[0]!.id
    id.progNational = (await db.query<{ id: string }>(`INSERT INTO programmes (title, status) VALUES ($1,'active') RETURNING id`, [`P4 National ${sfx}`])).rows[0]!.id
    for (const n of ['root', 'adminA', 'adminB', 'trainerA1', 'trainerA2', 'trainerB']) await doLogin(n)
    await db.query(`UPDATE users SET mfa_enabled = true WHERE id = $1`, [id.root])
  })
  after(async () => { await app.close(); await db.end() })

  test('capacity: six concurrent enrolments into a batch of three give exactly three seats', async () => {
    id.capBatch = await newBatch('CAP', 3)
    const results = await Promise.all(['t1', 't2', 't3', 't4', 't5', 't6'].map((t) => enrol('adminA', id.capBatch!, t)))
    assert.equal(results.filter((r) => r.status === 201).length, 3, JSON.stringify(results.map((r) => r.status)))
    assert.equal(results.filter((r) => r.status === 409).length, 3)
    const seats = (await db.query(`SELECT count(*)::int AS n FROM batch_enrolments WHERE batch_id = $1 AND status IN ('enrolled','in_progress','completed')`, [id.capBatch])).rows[0]
    assert.equal(seats.n, 3)
    const dup = results.find((r) => r.status === 201)!
    assert.equal((await call('POST', '/enrolments', 'adminA', { batchId: id.capBatch, traineeId: dup.body.traineeId })).status, 409)   // already enrolled
    assert.equal((await call('PATCH', `/batches/${id.capBatch}`, 'adminA', { capacity: 2 }, ver('"2"'))).status, 422)                    // capacity floor from Part 3
  })

  test('enrolment scope: another institution, trainees and outsiders cannot enrol or read', async () => {
    const batch = await newBatch('SCP', 5)
    assert.equal((await enrol('adminB', batch, 't1')).status, 404)                    // batch of another institution
    assert.equal((await enrol('trainerA1', batch, 't1')).status, 403)                 // trainers cannot enrol
    assert.equal((await call('POST', '/enrolments', 't1', { batchId: batch, traineeId: id.te_t1 })).status, 403)
    assert.equal((await call('POST', '/enrolments', 'adminA', { batchId: batch, traineeId: id.te_tB })).status, 422)  // trainee of another institution
    const ok = await enrol('adminA', batch, 't1'); assert.equal(ok.status, 201); assert.equal(ok.body.status, 'enrolled')
    assert.equal((await call('GET', `/enrolments/${ok.body.id}`, 'adminB')).status, 404)
    assert.equal((await call('GET', `/enrolments/${ok.body.id}`, 'trainerA2')).status, 404)         // not their batch
    assert.equal((await call('GET', `/enrolments/${ok.body.id}`, 'trainerA1')).status, 200)
    assert.equal((await call('GET', `/enrolments/${ok.body.id}`, 't2')).status, 404)                // another trainee
    const mine = await call('GET', '/enrolments', 't1'); assert.ok(mine.body.data.every((e: any) => e.traineeId === id.te_t1))
    const theirs = await call('GET', '/enrolments', 'trainerA2'); assert.equal(theirs.body.data.length, 0)
  })

  test('apply / approve / reject / withdraw workflow', async () => {
    const batch = await newBatch('APP', 1, { }); await db.query(`UPDATE batches SET status = 'planned' WHERE id = $1`, [batch])
    const applied = await call('POST', '/enrolments/apply', 't2', { batchId: batch })
    assert.equal(applied.status, 201); assert.equal(applied.body.status, 'applied')
    assert.equal((await call('POST', '/enrolments/apply', 't2', { batchId: batch })).status, 409)      // duplicate
    assert.equal((await call('POST', '/enrolments/apply', 'tB', { batchId: batch })).status, 404)      // other institution never sees it
    assert.equal((await call('POST', '/enrolments/apply', 'adminA', { batchId: batch })).status, 403)
    const t3 = await call('POST', '/enrolments/apply', 't3', { batchId: batch }); assert.equal(t3.status, 201)
    assert.equal((await call('POST', `/enrolments/${applied.body.id}/status`, 't2', { action: 'approve' })).status, 403)  // a trainee cannot approve
    const approved = await call('POST', `/enrolments/${applied.body.id}/status`, 'adminA', { action: 'approve' })
    assert.equal(approved.status, 200); assert.equal(approved.body.status, 'enrolled')
    assert.equal((await call('POST', `/enrolments/${t3.body.id}/status`, 'adminA', { action: 'approve' })).status, 409)  // batch (capacity 1) is now full
    assert.equal((await call('POST', `/enrolments/${t3.body.id}/status`, 'adminA', { action: 'reject' })).status, 422)   // reason needed
    assert.equal((await call('POST', `/enrolments/${t3.body.id}/status`, 'adminA', { action: 'reject', reason: 'No seats' })).body.status, 'rejected')
    assert.equal((await call('POST', `/enrolments/${applied.body.id}/status`, 't3', { action: 'withdraw' })).status, 404)   // not theirs
    assert.equal((await call('POST', `/enrolments/${applied.body.id}/status`, 't2', { action: 'withdraw' })).body.status, 'dropped')
    const again = await call('POST', '/enrolments/apply', 't3', { batchId: batch })                                        // a rejected row is reused
    assert.equal(again.status, 201); assert.equal(again.body.id, t3.body.id)
    const audit = await db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE 'enrolment.%' AND entity_id = $1`, [applied.body.id])
    assert.ok(audit.rows[0].n >= 3)
  })

  test('suspended institutions cannot take new enrolments', async () => {
    const b = (await db.query<{ id: string }>(`INSERT INTO batches (code, programme_id, institution_id, start_date, end_date, capacity, status) VALUES ($1,$2,$3,'2026-11-01','2027-01-31',5,'planned') RETURNING id`, [`SUSP-${sfx}`, id.progNational, id.instS])).rows[0]!.id
    const r = await call('POST', '/enrolments', 'root', { batchId: b, traineeId: id.te_t1 })
    assert.equal(r.status, 409)
  })

  test('LMS: content ownership, visibility, progress tracking', async () => {
    id.lmsBatch = await newBatch('LMS', 5)
    await enrol('adminA', id.lmsBatch, 't1')
    assert.equal((await call('POST', '/courses', 'adminA', { programmeId: id.progNational, title: 'National course' })).status, 403)     // national content is the super admin's
    assert.equal((await call('POST', '/courses', 'adminB', { programmeId: id.progA, title: 'Sneaky' })).status, 422)   // outside scope: programme not visible
    const course = await call('POST', '/courses', 'trainerA1', { programmeId: id.progA, title: 'Tailoring basics', position: 1 })
    assert.equal(course.status, 201); id.course = course.body.id
    const mod = await call('POST', '/modules', 'trainerA1', { courseId: id.course, title: 'Module 1' }); assert.equal(mod.status, 201)
    const l1 = await call('POST', '/lessons', 'trainerA1', { moduleId: mod.body.id, title: 'Lesson 1', position: 1 })
    const l2 = await call('POST', '/lessons', 'trainerA1', { moduleId: mod.body.id, title: 'Lesson 2', position: 2 })
    assert.equal(l1.status, 201); assert.equal(l2.status, 201)
    assert.equal((await call('GET', `/courses/${id.course}/outline`, 't1')).status, 404)                        // draft is hidden from trainees
    assert.equal((await call('PATCH', `/courses/${id.course}`, 'trainerA1', { status: 'published' }, ver(course.etag))).status, 200)
    assert.equal((await call('GET', `/courses/${id.course}/outline`, 't2')).status, 404)                        // not enrolled in this programme
    assert.equal((await call('GET', `/courses/${id.course}/outline`, 'adminB')).status, 404)
    const outline = await call('GET', `/courses/${id.course}/outline`, 't1')
    assert.equal(outline.status, 200); assert.equal(outline.body.modules[0].lessons.length, 2); assert.equal(outline.body.modules[0].lessons[0].progress, 'not_started')
    assert.equal((await call('POST', '/lessons', 't1', { moduleId: mod.body.id, title: 'x' })).status, 403)
    assert.equal((await call('PUT', `/lessons/${l1.body.id}/progress`, 't2', { status: 'completed' })).status, 404)   // not enrolled
    assert.equal((await call('PUT', `/lessons/${l1.body.id}/progress`, 't1', { status: 'completed' })).status, 200)
    const enrolment = (await call('GET', `/enrolments?batchId=${id.lmsBatch}`, 'adminA')).body.data[0]
    assert.equal(enrolment.progressPercent, 50); assert.equal(enrolment.status, 'in_progress')
    await call('PUT', `/lessons/${l2.body.id}/progress`, 't1', { status: 'completed' })
    assert.equal((await call('GET', `/enrolments/${enrolment.id}`, 'adminA')).body.progressPercent, 100)
    await call('DELETE', `/lessons/${l2.body.id}`, 'trainerA1')
    assert.equal((await call('GET', `/enrolments/${enrolment.id}`, 'adminA')).body.progressPercent, 100)   // 1 of 1 lessons left is done
    // stale If-Match
    assert.equal((await call('PATCH', `/courses/${id.course}`, 'trainerA1', { title: 'Stale' }, ver('"1"'))).status, 412)
    // resources: links only
    assert.equal((await call('POST', '/resources', 'trainerA1', { courseId: id.course, title: 'Bad', externalUrl: 'javascript:alert(1)' })).status, 422)
    const res = await call('POST', '/resources', 'trainerA1', { courseId: id.course, title: 'Guide', externalUrl: 'https://example.org/guide.pdf' }); assert.equal(res.status, 201)
    assert.equal((await call('GET', `/resources?courseId=${id.course}`, 't1')).body.data.length, 1)
    assert.equal((await call('GET', `/resources?courseId=${id.course}`, 't2')).status, 404)
  })

  test('sessions: overlap rule, scope, concurrent edit, timetable', async () => {
    id.sessBatch = await newBatch('SES', 5); const other = await newBatch('SE2', 5)
    const T0 = Date.now()                                   // one fixed base so the boundaries below are exact
    const at = (ms: number) => new Date(T0 + ms).toISOString()
    const body = (t: number, len = 2 * H, extra: Record<string, unknown> = {}) => ({ batchId: id.sessBatch, title: 'Class', startsAt: at(t), endsAt: at(t + len), ...extra })
    const s1 = await call('POST', '/sessions', 'trainerA1', body(48 * H)); assert.equal(s1.status, 201)
    assert.equal((await call('POST', '/sessions', 'trainerA1', body(49 * H))).status, 409)                                       // overlaps s1 (same batch)
    assert.equal((await call('POST', '/sessions', 'adminA', { ...body(49 * H), batchId: other })).status, 409)                     // same trainer, other batch
    assert.equal((await call('POST', '/sessions', 'adminA', body(50 * H + 1))).status, 201)                                        // just after: fine
    assert.equal((await call('POST', '/sessions', 'trainerA2', body(80 * H))).status, 404)                                         // not their batch
    assert.equal((await call('POST', '/sessions', 'adminB', body(80 * H))).status, 404)
    assert.equal((await call('POST', '/sessions', 'trainerA1', body(80 * H, 2 * H, { mode: 'online' }))).status, 422)              // needs joinUrl
    const parallel = await Promise.all([1, 2, 3].map(() => call('PATCH', `/sessions/${s1.body.id}`, 'trainerA1', { title: 'Renamed' }, ver(s1.etag))))
    assert.equal(parallel.filter((r) => r.status === 200).length, 1, JSON.stringify(parallel.map((r) => r.status)))
    assert.equal(parallel.filter((r) => r.status === 412).length, 2)
    const tt = await call('GET', `/timetable?from=${encodeURIComponent(iso(0))}&to=${encodeURIComponent(iso(10 * 24 * H))}&batchId=${id.sessBatch}`, 'trainerA1')
    assert.equal(tt.status, 200); assert.ok(tt.body.data.length >= 2); assert.equal((await call('GET', `/timetable?from=${encodeURIComponent(iso(0))}&to=${encodeURIComponent(iso(10 * 24 * H))}`, 'trainerA2')).body.data.filter((s: any) => s.batchId === id.sessBatch).length, 0)
    assert.equal((await call('GET', `/timetable?from=${encodeURIComponent(iso(0))}&to=${encodeURIComponent(iso(200 * 24 * H))}`, 'root')).status, 422)  // range too long
    assert.equal((await call('POST', `/sessions/${s1.body.id}/status`, 'trainerA1', { status: 'cancelled' })).body.status, 'cancelled')
    assert.equal((await call('POST', '/sessions', 'trainerA1', body(48 * H))).status, 201)                                          // cancelled sessions free the slot
  })

  test('attendance: marking, uniqueness, self check-in window, scoping, summary', async () => {
    id.attBatch = await newBatch('ATT', 5)
    await enrol('adminA', id.attBatch, 't1'); await enrol('adminA', id.attBatch, 't2')
    const now = Date.now()
    const mk = (startOffset: number, len: number, title: string) => call('POST', '/sessions', 'trainerA1', { batchId: id.attBatch, title, startsAt: iso(startOffset), endsAt: iso(startOffset + len) })
    const past = await mk(-10 * H, 2 * H, 'Past'); const live = await mk(5 * 60_000, 2 * H, 'Starting soon'); const future = await mk(72 * H, 2 * H, 'Future')
    for (const s of [past, live, future]) assert.equal(s.status, 201, JSON.stringify(s.body))
    const mark = (who: string, sessionId: string, records: unknown[]) => call('PUT', `/attendance/sessions/${sessionId}`, who, { records })
    assert.equal((await mark('t1', past.body.id, [{ traineeId: id.te_t1, status: 'present' }])).status, 403)                        // trainees cannot mark
    assert.equal((await mark('adminA', past.body.id, [{ traineeId: id.te_t1, status: 'present' }])).status, 403)                    // admins read only
    assert.equal((await mark('trainerA2', past.body.id, [{ traineeId: id.te_t1, status: 'present' }])).status, 404)                 // not their batch
    assert.equal((await mark('trainerA1', past.body.id, [{ traineeId: id.te_t4, status: 'present' }])).status, 422)      // no seat in this batch
    const first = await mark('trainerA1', past.body.id, [{ traineeId: id.te_t1, status: 'present' }, { traineeId: id.te_t2, status: 'absent' }])
    assert.equal(first.status, 200); assert.equal(first.body.data.length, 2)
    const fix = await mark('trainerA1', past.body.id, [{ traineeId: id.te_t2, status: 'excused', notes: 'Medical' }])              // correction, not a duplicate
    assert.equal(fix.status, 200)
    const rows = await db.query(`SELECT count(*)::int AS n FROM attendance WHERE session_id = $1`, [past.body.id]); assert.equal(rows.rows[0].n, 2)
    assert.equal((await mark('trainerA1', past.body.id, [{ traineeId: id.te_t1, status: 'present' }, { traineeId: id.te_t1, status: 'late' }])).status, 422)   // duplicates in one call
    // self check-in
    assert.equal((await call('POST', `/attendance/sessions/${future.body.id}/check-in`, 't1', {})).status, 409)                     // not open yet
    assert.equal((await call('POST', `/attendance/sessions/${live.body.id}/check-in`, 't1', { method: 'fingerprint' })).status, 422)
    assert.equal((await call('POST', `/attendance/sessions/${live.body.id}/check-in`, 't3', {})).status, 404)                       // no seat here
    assert.equal((await call('POST', `/attendance/sessions/${live.body.id}/check-in`, 't1', { method: 'qr' })).status, 422)          // qr is proof, not a claim (see part4.v3 tests)
    const ci = await call('POST', `/attendance/sessions/${live.body.id}/check-in`, 't1', { method: 'manual' })
    assert.equal(ci.status, 201); assert.equal(ci.body.status, 'present'); assert.equal(ci.body.method, 'manual')
    assert.equal((await call('POST', `/attendance/sessions/${live.body.id}/check-in`, 't1', {})).status, 409)                       // once only
    // visibility
    const own = await call('GET', '/attendance', 't1'); assert.ok(own.body.data.length >= 2 && own.body.data.every((a: any) => a.traineeId === id.te_t1))
    assert.equal((await call('GET', `/attendance?batchId=${id.attBatch}`, 'trainerA2')).body.data.length, 0)
    assert.equal((await call('GET', `/attendance?batchId=${id.attBatch}`, 'adminB')).body.data.length, 0)
    assert.equal((await call('GET', `/attendance/summary?batchId=${id.attBatch}`, 'trainerA2')).status, 404)
    // summary: only the past session counts (the live one has not ended), t2 was excused so the denominator is empty
    const sum = await call('GET', `/attendance/summary?batchId=${id.attBatch}`, 'trainerA1')
    const s1 = sum.body.data.find((r: any) => r.traineeId === id.te_t1); const s2 = sum.body.data.find((r: any) => r.traineeId === id.te_t2)
    assert.equal(s1.sessionsCounted, 1); assert.equal(s1.attendancePercent, 100); assert.equal(s2.attendancePercent, null); assert.equal(s2.excused, 1)
    const mineOnly = await call('GET', `/attendance/summary?batchId=${id.attBatch}`, 't1'); assert.equal(mineOnly.body.data.length, 1)
    void now
  })

  test('assessments: answer key hidden, auto grading, attempt limits, manual grading, scoping', async () => {
    id.asBatch = await newBatch('ASM', 5)
    await enrol('adminA', id.asBatch, 't1'); await enrol('adminA', id.asBatch, 't2')
    const questions = [
      { id: 'q1', type: 'mcq', prompt: '2+2?', marks: 5, options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }], correctOptionId: 'b' },
      { id: 'q2', type: 'mcq', prompt: '3+3?', marks: 5, options: [{ id: 'a', text: '6' }, { id: 'b', text: '7' }], correctOptionId: 'a' },
    ]
    assert.equal((await call('POST', '/assessments', 'trainerA1', { batchId: id.asBatch, title: 'Bad', totalMarks: 10, passMarks: 11 })).status, 422)
    assert.equal((await call('POST', '/assessments', 'trainerA1', { batchId: id.asBatch, title: 'Bad', totalMarks: 8, passMarks: 4, questions })).status, 422)     // marks do not add up
    assert.equal((await call('POST', '/assessments', 'trainerA2', { batchId: id.asBatch, title: 'X', totalMarks: 10, passMarks: 5, questions })).status, 404)
    assert.equal((await call('POST', '/assessments', 't1', { batchId: id.asBatch, title: 'X', totalMarks: 10, passMarks: 5 })).status, 403)
    const quiz = await call('POST', '/assessments', 'trainerA1', { batchId: id.asBatch, title: 'Quiz 1', totalMarks: 10, passMarks: 6, maxAttempts: 2, questions })
    assert.equal(quiz.status, 201); assert.ok(JSON.stringify(quiz.body.questions).includes('correctOptionId'))
    assert.equal((await call('GET', `/assessments/${quiz.body.id}`, 't1')).status, 404)                                       // drafts are hidden from trainees
    assert.equal((await call('POST', `/assessments/${quiz.body.id}/attempts`, 't1', { answers: {} })).status, 404)
    assert.equal((await call('POST', `/assessments/${quiz.body.id}/status`, 'trainerA1', { status: 'published' })).status, 200)
    const seen = await call('GET', `/assessments/${quiz.body.id}`, 't1'); assert.equal(seen.status, 200)
    assert.ok(!JSON.stringify(seen.body).includes('correctOptionId'), 'answer key leaked to a trainee')
    assert.equal((await call('PATCH', `/assessments/${quiz.body.id}`, 'trainerA1', { title: 'Nope' }, ver('"2"'))).status, 409)   // published: only the window is editable
    const bad = await call('POST', `/assessments/${quiz.body.id}/attempts`, 't1', { answers: { q1: 'zzz' } }); assert.equal(bad.status, 422)
    const a1 = await call('POST', `/assessments/${quiz.body.id}/attempts`, 't1', { answers: { q1: 'b', q2: 'b' } })
    assert.equal(a1.status, 201); assert.equal(a1.body.status, 'graded'); assert.equal(a1.body.score, 5); assert.equal(a1.body.passed, false); assert.equal(a1.body.attemptNo, 1)
    // parallel attempts cannot beat the limit (2): one is used, so only one more may succeed
    const par = await Promise.all([1, 2, 3, 4].map(() => call('POST', `/assessments/${quiz.body.id}/attempts`, 't1', { answers: { q1: 'b', q2: 'a' } })))
    assert.equal(par.filter((r) => r.status === 201).length, 1, JSON.stringify(par.map((r) => r.status)))
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM assessment_results WHERE assessment_id = $1 AND trainee_id = $2`, [quiz.body.id, id.te_t1])).rows[0].n, 2)
    assert.equal((await call('POST', `/assessments/${quiz.body.id}/attempts`, 't3', { answers: {} })).status, 404)              // not enrolled in the batch
    // results scoping
    const mine = await call('GET', `/assessments/${quiz.body.id}/results`, 't1'); assert.equal(mine.body.data.length, 2); assert.ok(mine.body.data.every((r: any) => r.answers === undefined))
    assert.equal((await call('GET', `/assessments/${quiz.body.id}/results`, 't2')).body.data.length, 0)
    assert.equal((await call('GET', `/assessments/${quiz.body.id}/results`, 'trainerA1')).body.data.length, 2)
    assert.equal((await call('GET', `/assessments/${quiz.body.id}/results`, 'trainerA2')).status, 404)
    // summary feeds certificates later: t1 passed on attempt 2
    const sum = await call('GET', `/assessments/summary?batchId=${id.asBatch}`, 'trainerA1')
    assert.equal(sum.body.data.find((r: any) => r.traineeId === id.te_t1).allPassed, true)
    assert.equal(sum.body.data.find((r: any) => r.traineeId === id.te_t2).allPassed, false)
    // manual grading with optimistic concurrency
    const essay = await call('POST', '/assessments', 'trainerA1', { batchId: id.asBatch, title: 'Project', assessmentType: 'assignment', totalMarks: 20, passMarks: 10 })
    assert.equal(essay.status, 201)
    assert.equal((await call('POST', `/assessments/${essay.body.id}/status`, 'trainerA1', { status: 'published' })).status, 200)
    const sub = await call('POST', `/assessments/${essay.body.id}/attempts`, 't2', { answers: {} })
    assert.equal(sub.status, 201); assert.equal(sub.body.status, 'submitted'); assert.equal(sub.body.score, null)
    const gradeUrl = `/assessments/${essay.body.id}/results/${sub.body.id}/grade`
    assert.equal((await call('POST', gradeUrl, 't2', { score: 20 }, ver('"1"'))).status, 403)
    assert.equal((await call('POST', gradeUrl, 'trainerA2', { score: 15 }, ver('"1"'))).status, 404)
    assert.equal((await call('POST', gradeUrl, 'trainerA1', { score: 21 }, ver('"1"'))).status, 422)
    const graded = await call('POST', gradeUrl, 'trainerA1', { score: 15, feedback: 'Good work' }, ver('"1"'))
    assert.equal(graded.status, 200); assert.equal(graded.body.passed, true); assert.equal(graded.body.status, 'graded')
    assert.equal((await call('POST', gradeUrl, 'trainerA1', { score: 12 }, ver('"1"'))).status, 412)                          // stale version
    const shown = (await call('GET', `/assessments/${essay.body.id}/results`, 't2')).body.data[0]; assert.equal(shown.score, 15); assert.equal(shown.feedback, 'Good work')
  })
})
