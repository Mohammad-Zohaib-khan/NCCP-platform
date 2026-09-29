/**
 * Part 3 integration tests: institutions, trainers, trainees, programmes, batches, against a real PostgreSQL with all
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
const mail: Array<{ to: string; text: string }> = []
const mailer: Mailer = { async send(m) { mail.push(m) } }
const email = (n: string) => `${n}.${sfx}@test.example`

describe('Part 3: institutions, people, programmes, batches (PostgreSQL)', { skip: !run }, () => {
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
    const r = await db.query<{ id: string }>(`INSERT INTO users (email, full_name, role_code, status, password_hash, email_verified_at) VALUES ($1,$2,$3,'active',$4, now()) RETURNING id`, [email(name), name, role, await hashPassword(PW)])
    id[name] = r.rows[0]!.id
  }
  async function login(name: string) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: email(name), password: PW } })
    assert.equal(res.statusCode, 200, `login ${name}`)
    tok[name] = res.json().accessToken
  }
  async function newBatch(who: string, code: string, extra: Record<string, unknown> = {}) {
    return call('POST', '/batches', who, { code, programmeId: id.progNational, institutionId: id.instA, startDate: '2026-11-01', endDate: '2027-01-31', capacity: 5, ...extra })
  }

  before(async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' })
    db = createPool(config); app = await buildApp({ config, db, mailer })
    for (const [k, status] of [['A', 'active'], ['B', 'active'], ['S', 'suspended']] as const) {
      id[`inst${k}`] = (await db.query<{ id: string }>(`INSERT INTO institutions (name, status) VALUES ($1,$2) RETURNING id`, [`Inst ${k} ${sfx}`, status])).rows[0]!.id
    }
    await seedUser('root', 'super_admin'); await seedUser('adminA', 'institution_admin'); await seedUser('adminB', 'institution_admin')
    await seedUser('trainerA1', 'trainer'); await seedUser('trainerA2', 'trainer'); await seedUser('trainerB', 'trainer')
    await seedUser('traineeA1', 'trainee'); await seedUser('traineeA2', 'trainee'); await seedUser('traineeB', 'trainee')
    await db.query(`INSERT INTO institution_users (institution_id, user_id, org_role) VALUES ($1,$2,'admin'),($3,$4,'admin')`, [id.instA, id.adminA, id.instB, id.adminB])
    for (const [n, inst] of [['trainerA1', 'instA'], ['trainerA2', 'instA'], ['trainerB', 'instB']] as const)
      id[`tr_${n}`] = (await db.query<{ id: string }>(`INSERT INTO trainers (user_id, institution_id) VALUES ($1,$2) RETURNING id`, [id[n], id[inst]])).rows[0]!.id
    for (const [n, inst] of [['traineeA1', 'instA'], ['traineeA2', 'instA'], ['traineeB', 'instB']] as const)
      id[`te_${n}`] = (await db.query<{ id: string }>(`INSERT INTO trainees (user_id, institution_id, date_of_birth, skills) VALUES ($1,$2,'2001-05-17','{tailoring}') RETURNING id`, [id[n], id[inst]])).rows[0]!.id
    await db.query(`UPDATE users SET phone = '9000000001' WHERE id = $1`, [id.traineeA1])
    id.progNational = (await db.query<{ id: string }>(`INSERT INTO programmes (title, status) VALUES ($1,'active') RETURNING id`, [`National ${sfx}`])).rows[0]!.id
    id.progDraftNat = (await db.query<{ id: string }>(`INSERT INTO programmes (title, status) VALUES ($1,'draft') RETURNING id`, [`Draft ${sfx}`])).rows[0]!.id
    for (const n of ['root', 'adminA', 'adminB', 'trainerA1', 'trainerA2', 'trainerB', 'traineeA1', 'traineeA2', 'traineeB']) await login(n)
    // The super admin must enrol MFA before any route works; flipping the flag (the DB is authoritative on every request) keeps the tests short.
    await db.query(`UPDATE users SET mfa_enabled = true WHERE id = $1`, [id.root])
  })
  after(async () => { await app.close(); await db.end() })

  test('institution scope isolation: an admin lists and reads only their own institution; another institution is a 404', async () => {
    const list = await call('GET', '/institutions', 'adminA')
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.data.map((i: any) => i.id), [id.instA])
    assert.equal((await call('GET', `/institutions/${id.instB}`, 'adminA')).status, 404)
    assert.equal((await call('PATCH', `/institutions/${id.instB}`, 'adminA', { name: 'Hacked' }, ver())).status, 404)
    assert.equal((await call('GET', `/institutions/${id.instA}/admins`, 'adminB')).status, 404)
    const all = await call('GET', '/institutions?limit=100', 'root')
    assert.ok([id.instA, id.instB].every((x) => all.body.data.some((i: any) => i.id === x)))
    assert.equal((await call('GET', '/institutions', 'traineeA1')).status, 403)
  })

  test('institution approval workflow: pending -> active, reason rules, only super admin, invalid transitions 409', async () => {
    const created = await call('POST', '/institutions', 'root', { name: `New Coop ${sfx}`, state: 'Kerala' })
    assert.equal(created.status, 201); assert.equal(created.body.status, 'pending')
    const nid = created.body.id
    assert.equal((await call('POST', `/institutions/${nid}/status`, 'adminA', { action: 'approve' })).status, 403)
    assert.equal((await call('POST', '/institutions', 'adminA', { name: 'Nope Coop' })).status, 403)
    assert.equal((await call('POST', `/institutions/${nid}/status`, 'root', { action: 'reject' })).status, 422)
    assert.equal((await call('POST', `/institutions/${nid}/status`, 'root', { action: 'suspend', reason: 'because' })).status, 409)
    const ok = await call('POST', `/institutions/${nid}/status`, 'root', { action: 'approve' })
    assert.equal(ok.status, 200); assert.equal(ok.body.status, 'active')
    assert.equal((await call('POST', `/institutions/${nid}/status`, 'root', { action: 'approve' })).status, 409)
    assert.equal((await call('POST', `/institutions/${nid}/status`, 'root', { action: 'suspend', reason: 'licence lapsed' })).body.status, 'suspended')
    assert.equal((await call('POST', `/institutions/${nid}/status`, 'root', { action: 'reactivate' })).body.status, 'active')
    const audit = await db.query(`SELECT action FROM audit_logs WHERE entity_type = 'institution' AND entity_id = $1 ORDER BY created_at`, [nid])
    assert.deepEqual(audit.rows.map((r) => r.action), ['institution.create', 'institution.approve', 'institution.suspend', 'institution.reactivate'])
    assert.equal((await call('DELETE', `/institutions/${nid}`, 'root')).status, 204)
    assert.equal((await call('GET', `/institutions/${nid}`, 'root')).status, 404)
    assert.equal((await call('DELETE', `/institutions/${id.instA}`, 'root')).status, 409) // still has trainers / trainees
  })

  test('public application: 202, never reveals duplicates, one pending row per contact email, rejects bad input', async () => {
    const body = { name: `Applicant ${sfx}`, state: 'Gujarat', contactName: 'Asha', contactEmail: email('applicant') }
    assert.equal((await call('POST', '/institutions/apply', null, body)).status, 202)
    assert.equal((await call('POST', '/institutions/apply', null, { ...body, name: 'Another name' })).status, 202)
    const rows = await db.query(`SELECT status FROM institutions WHERE contact_email = $1`, [email('applicant')])
    assert.equal(rows.rowCount, 1); assert.equal(rows.rows[0].status, 'pending')
    assert.equal((await call('POST', '/institutions/apply', null, { name: 'x' })).status, 422)
    assert.equal((await call('POST', '/institutions/apply', null, { ...body, status: 'active' })).status, 422) // strict schema: cannot self-approve
  })

  test('concurrent PATCH with the same If-Match: exactly one wins, the other gets 412', async () => {
    const before = await call('GET', `/institutions/${id.instA}`, 'adminA')
    const etag = before.etag!
    const results = await Promise.all([
      call('PATCH', `/institutions/${id.instA}`, 'adminA', { district: 'North' }, { 'if-match': etag }),
      call('PATCH', `/institutions/${id.instA}`, 'adminA', { district: 'South' }, { 'if-match': etag }),
    ])
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 412])
    assert.equal((await call('PATCH', `/institutions/${id.instA}`, 'adminA', { district: 'East' })).status, 400) // If-Match is mandatory
  })

  test('cannot remove the last administrator of an active institution', async () => {
    assert.equal((await call('DELETE', `/institutions/${id.instA}/admins/${id.adminA}`, 'root')).status, 409)
    assert.equal((await call('DELETE', `/institutions/${id.instA}/admins/${id.adminA}`, 'adminA')).status, 403)
  })

  test('trainer create: user + profile + invitation in one step, mail sent after commit, foreign institution is a 404, duplicate email 409', async () => {
    const res = await call('POST', '/trainers', 'adminA', { email: email('newtrainer'), fullName: 'New Trainer', expertise: ['Accounting', 'accounting', 'GST'] })
    assert.equal(res.status, 201)
    assert.equal(res.body.trainer.institutionId, id.instA); assert.equal(res.body.emailSent, true)
    assert.deepEqual(res.body.trainer.expertise, ['Accounting', 'GST'])
    assert.equal(res.body.trainer.userStatus, 'invited')
    assert.ok(mail.some((m) => m.to === email('newtrainer') && m.text.includes('accept-invite?token=')))
    assert.equal((await call('POST', '/trainers', 'adminA', { email: email('x2'), fullName: 'Other', institutionId: id.instB })).status, 404)
    assert.equal((await call('POST', '/trainers', 'adminA', { email: email('newtrainer'), fullName: 'Dup Trainer' })).status, 409)
    assert.equal((await call('POST', '/trainers', 'trainerA1', { email: email('x3'), fullName: 'Nope Nope' })).status, 403)
    id.newTrainer = res.body.trainer.id
  })

  test('trainer scoping and self-service: list is institution-scoped; /me edits only allowed fields', async () => {
    const list = await call('GET', '/trainers?limit=100', 'adminA')
    assert.ok(list.body.data.length >= 3); assert.ok(list.body.data.every((t: any) => t.institutionId === id.instA))
    assert.equal((await call('GET', `/trainers/${id.tr_trainerB}`, 'adminA')).status, 404)
    const me = await call('GET', '/trainers/me', 'trainerA1')
    assert.equal(me.status, 200); assert.equal(me.body.userId, id.trainerA1)
    const ok = await call('PATCH', '/trainers/me', 'trainerA1', { expertise: ['Tailoring'], qualifications: 'ITI' }, { 'if-match': me.etag! })
    assert.equal(ok.status, 200); assert.deepEqual(ok.body.expertise, ['Tailoring'])
    assert.equal((await call('PATCH', '/trainers/me', 'trainerA1', { status: 'inactive' }, { 'if-match': ok.etag! })).status, 422) // not self-editable
    assert.equal((await call('PATCH', '/trainers/me', 'trainerA1', { qualifications: 'X' }, { 'if-match': me.etag! })).status, 412) // stale
    assert.equal((await call('GET', '/trainers/me', 'traineeA1')).status, 404)
  })

  test('trainee create + visibility: trainers see only trainees in their own batches, without date of birth and phone', async () => {
    const b = await newBatch('adminA', `VIS-${sfx}`, { trainerId: id.tr_trainerA1 })
    assert.equal(b.status, 201)
    await db.query(`INSERT INTO batch_enrolments (batch_id, trainee_id, status) VALUES ($1,$2,'enrolled')`, [b.body.id, id.te_traineeA1])
    const list = await call('GET', '/trainees?limit=100', 'trainerA1')
    assert.deepEqual(list.body.data.map((t: any) => t.id), [id.te_traineeA1])
    assert.equal('dateOfBirth' in list.body.data[0], false); assert.equal('phone' in list.body.data[0], false)
    assert.equal((await call('GET', `/trainees/${id.te_traineeA2}`, 'trainerA1')).status, 404) // same institution, not in their batch
    assert.equal((await call('GET', `/trainees/${id.te_traineeA1}`, 'trainerA2')).status, 404) // other trainer, same institution
    const admin = await call('GET', `/trainees/${id.te_traineeA1}`, 'adminA')
    assert.equal(admin.status, 200); assert.equal(admin.body.dateOfBirth, '2001-05-17'); assert.equal(admin.body.phone, '9000000001')
    assert.equal((await call('GET', `/trainees/${id.te_traineeB}`, 'adminA')).status, 404)
    assert.equal((await call('GET', '/trainees', 'traineeA1')).status, 403)
    const created = await call('POST', '/trainees', 'adminA', { email: email('newtrainee'), fullName: 'New Trainee', institutionId: id.instA, gender: 'female', dateOfBirth: '2003-02-10', skills: ['Stitching'], careerProfile: { headline: 'Tailor' } })
    assert.equal(created.status, 201); assert.equal(created.body.trainee.userStatus, 'invited')
    assert.equal((await call('POST', '/trainees', 'adminA', { email: email('bad'), fullName: 'Bad Date', dateOfBirth: '2999-01-01' })).status, 422)
    assert.equal((await call('POST', '/trainees', 'adminA', { email: email('bad2'), fullName: 'Bad Date', dateOfBirth: '2003-02-30' })).status, 422)
  })

  test('a trainee sees and edits only their own record', async () => {
    const me = await call('GET', '/trainees/me', 'traineeA1')
    assert.equal(me.status, 200); assert.equal(me.body.id, id.te_traineeA1)
    const ok = await call('PATCH', '/trainees/me', 'traineeA1', { skills: ['Tailoring', 'tailoring', 'Embroidery'], openToWork: false }, { 'if-match': me.etag! })
    assert.equal(ok.status, 200); assert.deepEqual(ok.body.skills, ['Tailoring', 'Embroidery']); assert.equal(ok.body.openToWork, false)
    for (const bad of [{ fullName: 'Renamed' }, { status: 'graduated' }, { dateOfBirth: '2000-01-01' }, { institutionId: id.instB }])
      assert.equal((await call('PATCH', '/trainees/me', 'traineeA1', bad, { 'if-match': ok.etag! })).status, 422, JSON.stringify(bad))
    assert.equal((await call('GET', `/trainees/${id.te_traineeA2}`, 'traineeA1')).status, 403) // no trainees:read permission at all
  })

  test('programme lifecycle: draft -> submit -> approve, edit locks, non-admin cannot approve, national by super admin', async () => {
    const created = await call('POST', '/programmes', 'adminA', { title: `Tailoring ${sfx}`, category: 'Skills', durationWeeks: 12 })
    assert.equal(created.status, 201); assert.equal(created.body.institutionId, id.instA); assert.equal(created.body.status, 'draft')
    const pid = created.body.id
    const edit = await call('PATCH', `/programmes/${pid}`, 'adminA', { durationWeeks: 16 }, { 'if-match': created.etag! })
    assert.equal(edit.status, 200); assert.equal(edit.body.durationWeeks, 16)
    assert.equal((await call('POST', `/programmes/${pid}/status`, 'adminA', { action: 'approve' })).status, 403)
    assert.equal((await call('POST', `/programmes/${pid}/status`, 'adminA', { action: 'submit' })).body.status, 'pending_approval')
    assert.equal((await call('PATCH', `/programmes/${pid}`, 'adminA', { title: 'Renamed programme' }, { 'if-match': '"99"' })).status, 409) // not editable while pending (checked before version)
    assert.equal((await call('POST', `/programmes/${pid}/status`, 'root', { action: 'reject' })).status, 422)
    const rej = await call('POST', `/programmes/${pid}/status`, 'root', { action: 'reject', reason: 'Syllabus incomplete' })
    assert.equal(rej.body.status, 'rejected'); assert.equal(rej.body.rejectionReason, 'Syllabus incomplete')
    assert.equal((await call('POST', `/programmes/${pid}/status`, 'adminA', { action: 'submit' })).body.rejectionReason, null)
    assert.equal((await call('POST', `/programmes/${pid}/status`, 'root', { action: 'approve' })).body.status, 'active')
    assert.equal((await call('GET', `/programmes/${pid}`, 'adminB')).status, 404) // other institution
    assert.equal((await call('GET', `/programmes/${pid}`, 'traineeA1')).status, 200) // active + own institution
    assert.equal((await call('GET', `/programmes/${pid}`, 'traineeB')).status, 404)
    // national programme: only super admin writes; may be approved straight from draft; institution admin sees it once active
    assert.equal((await call('POST', '/programmes', 'adminA', { title: 'National attempt', institutionId: null })).body?.institutionId, id.instA)
    const nat = await call('POST', '/programmes', 'root', { title: `National Digital ${sfx}` })
    assert.equal(nat.body.isNational, true)
    assert.equal((await call('GET', `/programmes/${nat.body.id}`, 'adminA')).status, 404) // draft national: invisible to institutions
    assert.equal((await call('POST', `/programmes/${nat.body.id}/status`, 'root', { action: 'approve' })).body.status, 'active')
    assert.equal((await call('GET', `/programmes/${nat.body.id}`, 'adminA')).status, 200)
    assert.equal((await call('PATCH', `/programmes/${nat.body.id}`, 'adminA', { title: 'Hijack' }, { 'if-match': '"2"' })).status, 403)
    assert.equal((await call('DELETE', `/programmes/${pid}`, 'adminA')).status, 204)
  })

  test('batch creation rules: dates, capacity, programme and trainer eligibility, duplicate code', async () => {
    const ok = await newBatch('adminA', `B1-${sfx}`, { trainerId: id.tr_trainerA1 })
    assert.equal(ok.status, 201); assert.equal(ok.body.seatsLeft, 5); assert.equal(ok.body.trainerName, 'trainerA1'); assert.ok(ok.body.programmeTitle)
    assert.equal((await newBatch('adminA', `B2-${sfx}`, { startDate: '2026-12-01', endDate: '2026-11-01' })).status, 422)
    assert.equal((await newBatch('adminA', `B3-${sfx}`, { startDate: '2026-02-30' })).status, 422)
    assert.equal((await newBatch('adminA', `B4-${sfx}`, { capacity: 0 })).status, 422)
    assert.equal((await newBatch('adminA', `B5-${sfx}`, { programmeId: id.progDraftNat })).status, 422) // draft programme
    assert.equal((await newBatch('adminA', `B6-${sfx}`, { trainerId: id.tr_trainerB })).status, 422) // trainer of another institution
    assert.equal((await newBatch('adminA', `B1-${sfx}`)).status, 409) // duplicate code in the institution
    assert.equal((await newBatch('adminA', `B7-${sfx}`, { institutionId: id.instB })).status, 404) // foreign institution
    assert.equal((await newBatch('trainerA1', `B8-${sfx}`)).status, 403)
    assert.equal((await newBatch('adminB', `B1-${sfx}`, { institutionId: id.instB })).status, 201) // same code allowed in another institution
  })

  test('suspended institution cannot get new batches, trainers, trainees or programmes', async () => {
    assert.equal((await call('POST', '/batches', 'root', { code: `SUS-${sfx}`, programmeId: id.progNational, institutionId: id.instS, startDate: '2026-11-01', endDate: '2026-12-01', capacity: 5 })).status, 409)
    assert.equal((await call('POST', '/trainers', 'root', { email: email('sus1'), fullName: 'Sus Trainer', institutionId: id.instS })).status, 409)
    assert.equal((await call('POST', '/trainees', 'root', { email: email('sus2'), fullName: 'Sus Trainee', institutionId: id.instS })).status, 409)
    assert.equal((await call('POST', '/programmes', 'root', { title: 'Sus programme', institutionId: id.instS })).status, 409)
    assert.equal((await db.query(`SELECT 1 FROM users WHERE email IN ($1,$2)`, [email('sus1'), email('sus2')])).rowCount, 0) // nothing leaked from the rolled-back transactions
  })

  test('batch update, capacity floor, lifecycle transitions, trainer assignment', async () => {
    const b = await newBatch('adminA', `LIFE-${sfx}`)
    const bid = b.body.id
    await db.query(`INSERT INTO batch_enrolments (batch_id, trainee_id, status) VALUES ($1,$2,'enrolled'),($1,$3,'dropped')`, [bid, id.te_traineeA1, id.te_traineeA2]) // dropped does not occupy a seat
    const seats = await call('GET', `/batches/${bid}`, 'adminA')
    assert.equal(seats.body.enrolledCount, 1); assert.equal(seats.body.seatsLeft, 4)
    assert.equal((await call('PATCH', `/batches/${bid}`, 'adminA', { capacity: 0 }, { 'if-match': seats.etag! })).status, 422)
    const shrink = await call('PATCH', `/batches/${bid}`, 'adminA', { capacity: 1 }, { 'if-match': seats.etag! })
    assert.equal(shrink.status, 200); assert.equal(shrink.body.seatsLeft, 0)
    assert.equal((await call('POST', `/batches/${bid}/status`, 'adminA', { status: 'ongoing' })).status, 409) // needs a trainer
    assert.equal((await call('PUT', `/batches/${bid}/trainer`, 'adminA', { trainerId: id.tr_trainerB })).status, 422)
    assert.equal((await call('PUT', `/batches/${bid}/trainer`, 'adminA', { trainerId: id.tr_trainerA2 })).body.trainerId, id.tr_trainerA2)
    assert.equal((await call('POST', `/batches/${bid}/status`, 'adminA', { status: 'ongoing' })).body.status, 'ongoing')
    assert.equal((await call('PUT', `/batches/${bid}/trainer`, 'adminA', { trainerId: null })).status, 409) // ongoing keeps a trainer
    assert.equal((await call('POST', `/batches/${bid}/status`, 'adminA', { status: 'ongoing' })).status, 409)
    assert.equal((await call('DELETE', `/batches/${bid}`, 'adminA')).status, 409) // has enrolments
    assert.equal((await call('POST', `/batches/${bid}/status`, 'adminA', { status: 'completed' })).body.status, 'completed')
    const cur = await call('GET', `/batches/${bid}`, 'adminA')
    assert.equal((await call('PATCH', `/batches/${bid}`, 'adminA', { schedule: 'Mon' }, { 'if-match': cur.etag! })).status, 409) // closed
    assert.equal((await call('POST', `/batches/${bid}/status`, 'adminA', { status: 'cancelled' })).status, 409)
  })

  test('concurrent batch PATCH with the same If-Match: exactly one 200 and one 412', async () => {
    const b = await newBatch('adminA', `RACE-${sfx}`)
    const results = await Promise.all([
      call('PATCH', `/batches/${b.body.id}`, 'adminA', { schedule: 'Mon, Wed' }, { 'if-match': b.etag! }),
      call('PATCH', `/batches/${b.body.id}`, 'adminA', { schedule: 'Tue, Thu' }, { 'if-match': b.etag! }),
    ])
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 412])
  })

  test('batch visibility: trainer only own batches; trainee enrolled + planned of own institution; other tenants 404', async () => {
    const own = await newBatch('adminA', `TV1-${sfx}`, { trainerId: id.tr_trainerA1 })
    const other = await newBatch('adminA', `TV2-${sfx}`, { trainerId: id.tr_trainerA2 })
    const foreign = await call('POST', '/batches', 'adminB', { code: `TV3-${sfx}`, programmeId: id.progNational, startDate: '2026-11-01', endDate: '2026-12-01', capacity: 3 })
    const t1 = await call('GET', '/batches?limit=100', 'trainerA1')
    assert.ok(t1.body.data.length >= 1); assert.ok(t1.body.data.every((x: any) => x.trainerId === id.tr_trainerA1))
    assert.equal((await call('GET', `/batches/${other.body.id}`, 'trainerA1')).status, 404)
    assert.equal((await call('GET', `/batches/${own.body.id}`, 'trainerA1')).status, 200)
    assert.equal((await call('PATCH', `/batches/${own.body.id}`, 'trainerA1', { schedule: 'x' }, { 'if-match': own.etag! })).status, 403)
    const t = await call('GET', '/batches?limit=100', 'traineeA2')
    assert.ok(t.body.data.every((x: any) => x.institutionId === id.instA)); assert.ok(t.body.data.some((x: any) => x.id === other.body.id)) // planned, own institution
    assert.equal((await call('GET', `/batches/${foreign.body.id}`, 'traineeA2')).status, 404)
    assert.equal((await call('GET', `/batches/${foreign.body.id}`, 'adminA')).status, 404)
    assert.equal((await call('GET', `/batches?institutionId=${id.instB}`, 'adminA')).status, 404)
    await call('POST', `/batches/${other.body.id}/status`, 'adminA', { status: 'cancelled' })
    const after = await call('GET', '/batches?limit=100', 'traineeA2')
    assert.equal(after.body.data.some((x: any) => x.id === other.body.id), false) // no longer planned and not enrolled
  })

  test('cursor pagination returns every row exactly once, including identical sort values (ties)', async () => {
    const made: string[] = []
    for (let i = 0; i < 7; i++) { const r = await newBatch('adminA', `PG-${i}-${sfx}`, { startDate: '2026-12-15', endDate: '2027-01-15' }); assert.equal(r.status, 201); made.push(r.body.id) }
    for (const sort of ['start_date', '-start_date', 'code', '-created_at', 'created_at']) {
      const seen: string[] = []; let cursor: string | null = null; let pages = 0
      do {
        const res: any = await call('GET', `/batches?q=PG-&limit=3&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`, 'adminA')
        assert.equal(res.status, 200, sort); seen.push(...res.body.data.map((x: any) => x.id)); cursor = res.body.page.nextCursor; pages++
        assert.ok(pages < 10)
      } while (cursor)
      assert.equal(seen.length, new Set(seen).size, `duplicates with sort=${sort}`)
      assert.deepEqual([...seen].sort(), [...made].sort(), `missing rows with sort=${sort}`)
    }
    assert.equal((await call('GET', '/batches?sort=password', 'adminA')).status, 422)
    assert.equal((await call('GET', '/batches?cursor=garbage', 'adminA')).status, 400)
    assert.equal((await call('GET', '/batches?sort=code&limit=2&cursor=' + Buffer.from(JSON.stringify({ sort: 'x', id: "1' OR '1'='1" })).toString('base64url'), 'adminA')).status, 400)
  })

  test('trainer delete: refused while on planned/ongoing batches; then soft-deletes, disables the user and ends their sessions', async () => {
    const b = await newBatch('adminA', `DEL-${sfx}`, { trainerId: id.newTrainer })
    const refused = await call('DELETE', `/trainers/${id.newTrainer}`, 'adminA')
    assert.equal(refused.status, 409)
    await call('POST', `/batches/${b.body.id}/status`, 'adminA', { status: 'cancelled' })
    // give the new trainer a live session so revocation is observable
    const uid = (await db.query<{ user_id: string }>(`SELECT user_id FROM trainers WHERE id = $1`, [id.newTrainer])).rows[0]!.user_id
    await db.query(`UPDATE users SET status='active', password_hash=$2 WHERE id=$1`, [uid, await hashPassword(PW)])
    const lg = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: email('newtrainer'), password: PW } })
    assert.equal(lg.statusCode, 200)
    assert.equal((await call('DELETE', `/trainers/${id.newTrainer}`, 'adminA')).status, 204)
    assert.equal((await call('GET', `/trainers/${id.newTrainer}`, 'adminA')).status, 404)
    const u = await db.query(`SELECT status, deleted_at FROM users WHERE id = $1`, [uid])
    assert.equal(u.rows[0].status, 'disabled'); assert.ok(u.rows[0].deleted_at)
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/trainers/me', headers: { authorization: `Bearer ${lg.json().accessToken}` } })).statusCode, 401)
  })

  test('users list pagination keeps microsecond precision (Part 2 fix)', async () => {
    const stamp = '2026-09-29 10:00:00.000000+00'
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push((await db.query<{ id: string }>(`INSERT INTO users (email, full_name, role_code, status, created_at) VALUES ($1,$2,'trainee','active', $3::timestamptz + make_interval(secs => $4::float8 / 1000000)) RETURNING id`, [email(`us${i}`), `Micro ${i}`, stamp, i])).rows[0]!.id)
    const seen: string[] = []; let cursor: string | null = null
    do {
      const res: any = await call('GET', `/users?q=Micro&limit=2${cursor ? `&cursor=${cursor}` : ''}`, 'root')
      seen.push(...res.body.data.map((u: any) => u.id)); cursor = res.body.page.nextCursor
      assert.equal(res.body.data.every((u: any) => !('_sort' in u)), true)
    } while (cursor)
    assert.deepEqual([...seen].sort(), [...ids].sort())
  })
})
