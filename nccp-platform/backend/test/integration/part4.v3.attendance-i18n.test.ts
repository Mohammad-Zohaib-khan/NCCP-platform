/**
 * Part 4 revision (brief v3) integration tests: verified QR attendance, fingerprint provider / Space-key simulator, optional face,
 * localized LMS content and the language preference. Skipped unless RUN_DB_TESTS=1. NOT yet executed by the author (no PostgreSQL or
 * npm registry in the build sandbox), so expect small fixes on the first real run.
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../../src/config/env.js'
import { createPool, type Db } from '../../src/db/pool.js'
import { buildApp } from '../../src/app.js'
import { hashPassword } from '../../src/auth/password.js'
import { issueQrToken } from '../../src/modules/learning/attendance.qr.js'
import type { Mailer } from '../../src/lib/mailer.js'

const run = process.env.RUN_DB_TESTS === '1'
const PW = 'Tr4ining-Portal!'
const sfx = Math.random().toString(36).slice(2, 8)
const mailer: Mailer = { async send() { /* not needed */ } }
const email = (n: string) => `${n}.${sfx}@v3.example`
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
const H = 3_600_000

describe('Part 4 v3: verified attendance and localized content (PostgreSQL)', { skip: !run }, () => {
  let app: FastifyInstance; let demoOff: FastifyInstance; let db: Db
  const id: Record<string, string> = {}; const tok: Record<string, string> = {}
  const send = (a: FastifyInstance) => async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, who: string | null, payload?: unknown, headers: Record<string, string> = {}) => {
    const res = await a.inject({ method, url: `/api/v1${url}`, payload: payload as never, headers: { ...(who ? { authorization: `Bearer ${tok[who]}` } : {}), ...headers } })
    let body: any = null; try { body = res.json() } catch { /* 204 */ }
    return { status: res.statusCode, body, etag: res.headers.etag as string | undefined }
  }
  let call: ReturnType<typeof send>; let callDemoOff: ReturnType<typeof send>

  async function seedUser(name: string, role: string) {
    id[name] = (await db.query<{ id: string }>(`INSERT INTO users (email, full_name, role_code, status, password_hash, email_verified_at) VALUES ($1,$2,$3,'active',$4, now()) RETURNING id`, [email(name), name, role, await hashPassword(PW)])).rows[0]!.id
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: email(name), password: PW } })
    assert.equal(res.statusCode, 200, `login ${name}`); tok[name] = res.json().accessToken
  }
  async function seedTrainee(name: string, inst: string) {
    await seedUser(name, 'trainee')
    id[`te_${name}`] = (await db.query<{ id: string }>(`INSERT INTO trainees (user_id, institution_id) VALUES ($1,$2) RETURNING id`, [id[name], id[inst]])).rows[0]!.id
  }

  before(async () => {
    const env = { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent', FEATURE_QR_ATTENDANCE: 'true', I18N_ENABLED_LANGUAGES: 'en,hi', I18N_DEFAULT_LANGUAGE: 'en' }
    const config = loadConfig({ ...env, FEATURE_FINGERPRINT_DEMO: 'true' })
    db = createPool(config); app = await buildApp({ config, db, mailer }); call = send(app)
    demoOff = await buildApp({ config: loadConfig({ ...env, FEATURE_FINGERPRINT_DEMO: 'false' }), db, mailer }); callDemoOff = send(demoOff)
    for (const k of ['A', 'B']) id[`inst${k}`] = (await db.query<{ id: string }>(`INSERT INTO institutions (name, status) VALUES ($1,'active') RETURNING id`, [`V3 Inst ${k} ${sfx}`])).rows[0]!.id
    await seedUser('root', 'super_admin'); await seedUser('adminA', 'institution_admin'); await seedUser('trainerA', 'trainer'); await seedUser('trainerB', 'trainer')
    await db.query(`INSERT INTO institution_users (institution_id, user_id, org_role) VALUES ($1,$2,'admin')`, [id.instA, id.adminA])
    for (const [n, inst] of [['trainerA', 'instA'], ['trainerB', 'instB']] as const) id[`tr_${n}`] = (await db.query<{ id: string }>(`INSERT INTO trainers (user_id, institution_id) VALUES ($1,$2) RETURNING id`, [id[n], id[inst]])).rows[0]!.id
    for (const n of ['t1', 't2', 't3']) await seedTrainee(n, 'instA')         // t1,t2 enrolled; t3 not
    await seedTrainee('tOut', 'instB')
    id.prog = (await db.query<{ id: string }>(`INSERT INTO programmes (title, status, institution_id) VALUES ($1,'active',$2) RETURNING id`, [`V3 Programme ${sfx}`, id.instA])).rows[0]!.id
    id.batch = (await db.query<{ id: string }>(`INSERT INTO batches (code, programme_id, institution_id, trainer_id, start_date, end_date, capacity, status) VALUES ($1,$2,$3,$4,'2026-01-01','2027-12-31',10,'ongoing') RETURNING id`, [`V3-${sfx}`.toUpperCase(), id.prog, id.instA, id.tr_trainerA])).rows[0]!.id
    for (const n of ['t1', 't2']) await db.query(`INSERT INTO batch_enrolments (batch_id, trainee_id, status) VALUES ($1,$2,'enrolled')`, [id.batch, id[`te_${n}`]])
  })
  after(async () => { await app.close(); await demoOff.close(); await db.end() })

  const newSession = async () => {
    const r = await call('POST', '/sessions', 'trainerA', { batchId: id.batch, title: `Live ${Math.random()}`, startsAt: iso(-10 * 60_000), endsAt: iso(2 * H) })
    assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id as string
  }

  test('QR: closed -> open -> scan -> duplicate/expired/forged/out-of-scope, then closed again', async () => {
    const sid = await newSession()
    assert.equal((await call('POST', `/attendance/sessions/${sid}/verify/qr`, 't1', { token: 'v1.0.aaaaaaaaaaaa.' + 'A'.repeat(43) })).status, 409)   // not open
    assert.equal((await call('POST', `/attendance/sessions/${sid}/open`, 't1')).status, 403)                       // trainee cannot open
    assert.equal((await call('POST', `/attendance/sessions/${sid}/open`, 'adminA')).status, 403)                    // admins read only
    assert.equal((await call('POST', `/attendance/sessions/${sid}/open`, 'trainerB')).status, 404)                  // not their batch
    const opened = await call('POST', `/attendance/sessions/${sid}/open`, 'trainerA'); assert.equal(opened.status, 200); assert.equal(opened.body.open, true); assert.equal(opened.body.openedBy, id.trainerA)
    assert.equal((await call('POST', `/attendance/sessions/${sid}/open`, 'trainerA')).body.openedAt, opened.body.openedAt)   // idempotent
    assert.equal((await call('GET', `/attendance/sessions/${sid}/qr`, 't1')).status, 403)                           // trainees never see the code
    const qr = await call('GET', `/attendance/sessions/${sid}/qr`, 'trainerA'); assert.equal(qr.status, 200)
    assert.equal((await call('POST', `/attendance/sessions/${sid}/verify/qr`, 't3', { token: qr.body.token })).status, 404)     // no seat
    assert.equal((await call('POST', `/attendance/sessions/${sid}/verify/qr`, 'tOut', { token: qr.body.token })).status, 404)   // other institution
    assert.equal((await call('POST', `/attendance/sessions/${sid}/verify/qr`, 't1', { token: qr.body.token.slice(0, -2) + 'xx' })).status, 422)   // forged
    const ok = await call('POST', `/attendance/sessions/${sid}/verify/qr`, 't1', { token: qr.body.token })
    assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.method, 'qr'); assert.equal(ok.body.verification, 'qr_token')
    const dup = await call('POST', `/attendance/sessions/${sid}/verify/qr`, 't1', { token: (await call('GET', `/attendance/sessions/${sid}/qr`, 'trainerA')).body.token })
    assert.equal(dup.status, 409); assert.equal(dup.body.error.details.code, 'ATTENDANCE_DUPLICATE')
    const secret = (await db.query<{ qr_secret: string }>(`SELECT qr_secret FROM class_sessions WHERE id = $1`, [sid])).rows[0]!.qr_secret
    const stale = issueQrToken(secret, sid, Date.now() - 120_000)
    const exp = await call('POST', `/attendance/sessions/${sid}/verify/qr`, 't2', { token: stale.token }); assert.equal(exp.status, 409); assert.equal(exp.body.error.details.code, 'QR_EXPIRED')
    assert.equal((await call('POST', `/attendance/sessions/${sid}/close`, 'trainerA')).body.open, false)
    assert.equal((await call('GET', `/attendance/sessions/${sid}/qr`, 'trainerA')).status, 409)
    assert.equal((await call('POST', `/attendance/sessions/${sid}/verify/qr`, 't2', { token: (issueQrToken(secret, sid, Date.now())).token })).status, 409)   // closed: old secret is gone
    const reopened = await call('POST', `/attendance/sessions/${sid}/open`, 'trainerA'); assert.equal(reopened.body.open, true)
    assert.equal((await call('POST', `/attendance/sessions/${sid}/verify/qr`, 't2', { token: issueQrToken(secret, sid, Date.now()).token })).status, 422)   // token from the previous opening no longer verifies
    const rows = await db.query(`SELECT count(*)::int AS n FROM attendance WHERE session_id = $1`, [sid]); assert.equal(rows.rows[0].n, 1)
    const audit = await db.query(`SELECT action FROM audit_logs WHERE entity_id = $1 AND action LIKE 'attendance.%' ORDER BY created_at`, [sid])
    assert.ok(['attendance.open', 'attendance.checkin', 'attendance.close'].every((a) => audit.rows.some((r: any) => r.action === a)))
  })

  test('concurrent QR scans by the same trainee create exactly one record', async () => {
    const sid = await newSession(); await call('POST', `/attendance/sessions/${sid}/open`, 'trainerA')
    const token = (await call('GET', `/attendance/sessions/${sid}/qr`, 'trainerA')).body.token
    const results = await Promise.all(Array.from({ length: 6 }, () => call('POST', `/attendance/sessions/${sid}/verify/qr`, 't1', { token })))
    assert.equal(results.filter((r) => r.status === 201).length, 1); assert.equal(results.filter((r) => r.status === 409).length, 5)
  })

  test('fingerprint: Space-key simulator works only when the demo flag is on (non-production); otherwise 503', async () => {
    const sid = await newSession(); await call('POST', `/attendance/sessions/${sid}/open`, 'trainerA')
    const m = await call('GET', '/attendance/methods', 't1'); assert.equal(m.body.fingerprint.simulated, true)
    assert.equal((await callDemoOff('GET', '/attendance/methods', 't1')).body.fingerprint.available, false)
    assert.equal((await call('POST', `/attendance/sessions/${sid}/verify/fingerprint`, 't1', { simulatedKey: 'Enter' })).status, 403)
    assert.equal((await callDemoOff('POST', `/attendance/sessions/${sid}/verify/fingerprint`, 't1', { simulatedKey: 'Space' })).status, 503)   // demo off: no simulator
    const ok = await call('POST', `/attendance/sessions/${sid}/verify/fingerprint`, 't1', { simulatedKey: 'Space' })
    assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.method, 'fingerprint'); assert.equal(ok.body.verification, 'fingerprint_simulated')
    assert.equal((await call('POST', `/attendance/sessions/${sid}/verify/fingerprint`, 't1', { simulatedKey: 'Space' })).status, 409)
  })

  test('face is unavailable by default, and manual / plain check-in still work', async () => {
    const sid = await newSession(); await call('POST', `/attendance/sessions/${sid}/open`, 'trainerA')
    assert.equal((await call('GET', '/attendance/methods', 't1')).body.face.available, false)
    assert.equal((await call('POST', `/attendance/sessions/${sid}/verify/face`, 't1', {})).status, 503)
    assert.equal((await call('POST', `/attendance/sessions/${sid}/check-in`, 't1', { method: 'qr' })).status, 422)
    assert.equal((await call('POST', `/attendance/sessions/${sid}/check-in`, 't1', { method: 'manual' })).status, 201)
    const bulk = await call('PUT', `/attendance/sessions/${sid}`, 'trainerA', { records: [{ traineeId: id.te_t2, status: 'present', method: 'fingerprint' }] }); assert.equal(bulk.status, 422)   // staff cannot hand-write verified methods
    assert.equal((await call('PUT', `/attendance/sessions/${sid}`, 'trainerA', { records: [{ traineeId: id.te_t2, status: 'present' }] })).status, 200)
  })

  test('localized LMS: translations, fallback flag, scoping, concurrency, progress stays on the lesson, saved preference', async () => {
    const course = await call('POST', '/courses', 'trainerA', { programmeId: id.prog, title: 'Cooperative Basics', description: 'Intro', status: 'published' }); assert.equal(course.status, 201, JSON.stringify(course.body))
    const mod = await call('POST', '/modules', 'trainerA', { courseId: course.body.id, title: 'Module One' })
    const les = await call('POST', '/lessons', 'trainerA', { moduleId: mod.body.id, title: 'Lesson One', lessonType: 'reading', content: 'English body' }); assert.equal(les.status, 201)
    const put = (kind: string, eid: string, lang: string, body: unknown, who = 'trainerA', h: Record<string, string> = {}) => call('PUT', `/${kind}/${eid}/translations/${lang}`, who, body, h)
    assert.equal((await put('courses', course.body.id, 'hi', { title: 'सहकारिता के मूल तत्व', description: 'परिचय' })).status, 200)
    assert.equal((await put('modules', mod.body.id, 'hi', { title: 'पहला मॉड्यूल' })).status, 200)
    const hiLesson = await put('lessons', les.body.id, 'hi', { title: 'पहला पाठ', content: 'हिंदी सामग्री' }); assert.equal(hiLesson.status, 200)
    assert.equal((await put('courses', course.body.id, 'en', { title: 'x y' })).status, 422)                               // default language is the base row
    assert.equal((await put('courses', course.body.id, 'fr', { title: 'x y' })).status, 422)                               // not enabled
    assert.equal((await put('modules', mod.body.id, 'hi', { title: 'नया', content: 'no' })).status, 422)                   // modules localise title only
    assert.equal((await put('courses', course.body.id, 'hi', { title: 'नया शीर्षक' })).status, 400)                        // replacing needs If-Match
    assert.equal((await put('courses', course.body.id, 'hi', { title: 'नया शीर्षक' }, 'trainerA', { 'if-match': '"99"' })).status, 412)
    assert.equal((await put('lessons', les.body.id, 'hi', { title: 'पहला पाठ v2', content: 'हिंदी सामग्री' }, 'trainerA', { 'if-match': hiLesson.etag! })).status, 200)
    assert.equal((await put('courses', course.body.id, 'hi', { title: 'हैक' }, 'trainerB')).status, 404)                    // other institution
    assert.equal((await put('courses', course.body.id, 'hi', { title: 'हैक' }, 't1')).status, 403)                          // trainees cannot author
    // trainee reads
    const hi = await call('GET', `/courses/${course.body.id}/outline?lang=hi`, 't1'); assert.equal(hi.status, 200)
    assert.equal(hi.body.title, 'सहकारिता के मूल तत्व'); assert.equal(hi.body.translated, true); assert.equal(hi.body.modules[0].title, 'पहला मॉड्यूल'); assert.equal(hi.body.modules[0].lessons[0].content, 'हिंदी सामग्री')
    assert.equal((await call('GET', `/courses/${course.body.id}/outline?lang=fr`, 't1')).status, 422)
    const lesson2 = await call('POST', '/lessons', 'trainerA', { moduleId: mod.body.id, title: 'Untranslated lesson', content: 'Only English' })
    const fb = await call('GET', `/lessons/${lesson2.body.id}?lang=hi`, 't1'); assert.equal(fb.body.title, 'Untranslated lesson'); assert.equal(fb.body.translated, false); assert.equal(fb.body.fallbackLanguage, 'en')
    assert.equal((await call('PUT', `/lessons/${les.body.id}/progress`, 't1', { status: 'completed' })).status, 200)
    const after = await call('GET', `/courses/${course.body.id}/outline?lang=hi`, 't1'); assert.equal(after.body.modules[0].lessons[0].progress, 'completed')
    const en = await call('GET', `/courses/${course.body.id}/outline?lang=en`, 't1'); assert.equal(en.body.modules[0].lessons[0].progress, 'completed'); assert.equal(en.body.title, 'Cooperative Basics')
    assert.equal((await call('GET', `/courses/${course.body.id}/outline`, 'tOut')).status, 404)
    // saved preference is used when ?lang is absent
    assert.equal((await call('PUT', '/me/language', 't1', { language: 'fr' })).status, 422)
    assert.equal((await call('PUT', '/me/language', 't1', { language: 'hi' })).status, 200)
    assert.equal((await call('GET', `/courses/${course.body.id}`, 't1')).body.title, 'सहकारिता के मूल तत्व')
    assert.equal((await call('GET', '/i18n/languages', 't1')).body.preferredLanguage, 'hi')
    const list = await call('GET', `/courses/${course.body.id}/translations`, 't1'); assert.equal(list.body.data.length, 1)
    assert.equal((await call('DELETE', `/courses/${course.body.id}/translations/hi`, 'trainerA')).status, 204)
    assert.equal((await call('GET', `/courses/${course.body.id}?lang=hi`, 't1')).body.translated, false)
  })
})
