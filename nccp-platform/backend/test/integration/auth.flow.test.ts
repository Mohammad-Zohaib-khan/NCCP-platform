/**
 * End-to-end auth/RBAC tests against a real PostgreSQL with all migrations applied.
 * Skipped unless RUN_DB_TESTS=1 (CI sets it). NOT yet executed by the author: the build sandbox had no PostgreSQL.
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../../src/config/env.js'
import { createPool, type Db } from '../../src/db/pool.js'
import { buildApp } from '../../src/app.js'
import { hashPassword } from '../../src/auth/password.js'
import { totpAt } from '../../src/auth/totp.js'
import type { Mailer } from '../../src/lib/mailer.js'

const run = process.env.RUN_DB_TESTS === '1'
const PW = 'Tr4ining-Portal!'
const sfx = Math.random().toString(36).slice(2, 8)
const mail: Array<{ to: string; text: string }> = []
const mailer: Mailer = { async send(m) { mail.push(m) } }

describe('auth + RBAC (PostgreSQL)', { skip: !run }, () => {
  let app: FastifyInstance; let db: Db
  const ids: Record<string, string> = {}
  const email = (n: string) => `${n}.${sfx}@test.example`

  async function seedUser(name: string, role: string, extra?: { institutionId?: string }) {
    const r = await db.query<{ id: string }>(`INSERT INTO users (email, full_name, role_code, status, password_hash, email_verified_at) VALUES ($1,$2,$3,'active',$4, now()) RETURNING id`, [email(name), name, role, await hashPassword(PW)])
    ids[name] = r.rows[0]!.id
    if (extra?.institutionId) await db.query(`INSERT INTO institution_users (institution_id, user_id, org_role) VALUES ($1,$2,'admin')`, [extra.institutionId, ids[name]])
  }
  async function login(name: string, password = PW) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: email(name), password } })
    const cookie = res.cookies.find((c) => c.name === 'nccp_rt')
    return { res, body: res.json(), cookie: cookie ? `nccp_rt=${cookie.value}` : undefined }
  }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` })

  before(async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' })
    db = createPool(config)
    app = await buildApp({ config, db, mailer })
    for (const k of ['A', 'B']) {
      const r = await db.query<{ id: string }>(`INSERT INTO institutions (name, status) VALUES ($1,'active') RETURNING id`, [`Inst ${k} ${sfx}`]); ids[`inst${k}`] = r.rows[0]!.id
    }
    await seedUser('adminA', 'institution_admin', { institutionId: ids.instA })
    await seedUser('adminB', 'institution_admin', { institutionId: ids.instB })
    await seedUser('trainee1', 'trainee'); await seedUser('lockme', 'trainee'); await seedUser('root', 'super_admin')
  })
  after(async () => { await app.close(); await db.end() })

  test('login succeeds, /auth/me returns role, workspace and permissions', async () => {
    const { res, body } = await login('adminA')
    assert.equal(res.statusCode, 200)
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(body.accessToken) })
    assert.equal(me.json().user.workspace, 'institution')
    assert.deepEqual(me.json().user.institutionIds, [ids.instA])
    assert.ok(me.json().user.permissions.includes('users:invite'))
  })

  test('unauthenticated and garbage tokens are rejected', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/users' })).statusCode, 401)
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth('a.b.c') })).statusCode, 401)
  })

  test('unknown email and wrong password give the same generic error', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: email('nobody'), password: PW } })
    const b = await login('trainee1', 'Wrong-Password-1!')
    assert.equal(a.statusCode, 401); assert.equal(b.res.statusCode, 401)
    assert.equal(a.json().error.message, b.body.error.message)
  })

  test('account locks after repeated failures; correct password then rejected with 423; audit written', async () => {
    for (let i = 0; i < 5; i++) await login('lockme', 'Wrong-Password-1!')
    const r = await login('lockme')
    assert.equal(r.res.statusCode, 423)
    const a = await db.query(`SELECT 1 FROM audit_logs WHERE action = 'auth.account_locked' AND actor_user_id = $1`, [ids.lockme])
    assert.equal(a.rowCount, 1)
  })

  test('refresh rotates; reusing an old refresh token revokes the whole family', async () => {
    const first = await login('trainee1')
    const h = { 'x-requested-with': 'nccp-web' }
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { ...h, cookie: first.cookie! } })
    assert.equal(r1.statusCode, 200)
    const newCookie = `nccp_rt=${r1.cookies.find((c) => c.name === 'nccp_rt')!.value}`
    // age the rotation past the two-tab grace window, then replay the OLD token
    await db.query(`UPDATE user_sessions SET revoked_at = now() - interval '1 minute' WHERE user_id = $1 AND revoked_reason = 'rotated'`, [ids.trainee1])
    const replay = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { ...h, cookie: first.cookie! } })
    assert.equal(replay.statusCode, 401)
    const afterReuse = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { ...h, cookie: newCookie } })
    assert.equal(afterReuse.statusCode, 401, 'family must be revoked')
    assert.ok((await db.query(`SELECT 1 FROM audit_logs WHERE action = 'auth.refresh_reuse_detected'`)).rowCount! >= 1)
  })

  test('refresh without the CSRF header is refused', async () => {
    const { cookie } = await login('trainee1')
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: cookie! } })).statusCode, 403)
  })

  test('logout takes effect immediately for the access token', async () => {
    const { body } = await login('trainee1')
    const s = await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: auth(body.accessToken) })
    const current = s.json().data.find((x: { current: boolean }) => x.current)
    await app.inject({ method: 'DELETE', url: `/api/v1/auth/sessions/${current.id}`, headers: auth(body.accessToken) })
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(body.accessToken) })).statusCode, 401)
  })

  test('RBAC: trainee cannot list users; institution admin cannot invite employers or admins', async () => {
    const t = (await login('trainee1')).body.accessToken
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(t) })).statusCode, 403)
    const a = (await login('adminA')).body.accessToken
    for (const role of ['employer', 'super_admin', 'institution_admin'])
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/users/invite', headers: auth(a), payload: { email: email(`x${role}`), fullName: 'Someone', role, institutionId: ids.instA } })).statusCode, 403)
  })

  test('cross-organisation isolation: admin A cannot invite into or see users of institution B', async () => {
    const a = (await login('adminA')).body.accessToken
    const inviteB = await app.inject({ method: 'POST', url: '/api/v1/users/invite', headers: auth(a), payload: { email: email('leak'), fullName: 'Leak Test', role: 'trainee', institutionId: ids.instB } })
    assert.equal(inviteB.statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/users/${ids.adminB}`, headers: auth(a) })).statusCode, 404)
    const list = await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(a) })
    assert.ok(!list.json().data.some((u: { id: string }) => u.id === ids.adminB))
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/users/${ids.adminB}/disable`, headers: auth(a) })).statusCode, 404)
  })

  test('invitation flow: invite → accept → login; token is single-use', async () => {
    const a = (await login('adminA')).body.accessToken
    const inv = await app.inject({ method: 'POST', url: '/api/v1/users/invite', headers: auth(a), payload: { email: email('newtrainee'), fullName: 'New Trainee', role: 'trainee', institutionId: ids.instA } })
    assert.equal(inv.statusCode, 201)
    const token = mail.at(-1)!.text.match(/token=([\w-]+)/)![1]!
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token, password: 'weak' } })).statusCode, 422)
    // failed policy check must not burn the token
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token, password: PW } })).statusCode, 204)
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token, password: PW } })).statusCode, 400)
    assert.equal((await login('newtrainee')).res.statusCode, 200)
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/users/invite', headers: auth(a), payload: { email: email('newtrainee'), fullName: 'Dup', role: 'trainee', institutionId: ids.instA } })).statusCode, 409)
  })

  test('password reset revokes sessions and always answers 202', async () => {
    const before = await login('adminB')
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: email('ghost') } })).statusCode, 202)
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: email('adminB') } })).statusCode, 202)
    const token = mail.at(-1)!.text.match(/token=([\w-]+)/)![1]!
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'Another-Str0ng-Pass!' } })).statusCode, 204)
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(before.body.accessToken) })).statusCode, 401)
    assert.equal((await login('adminB', 'Another-Str0ng-Pass!')).res.statusCode, 200)
  })

  test('super admin must enrol MFA before doing anything else; then MFA is required at login', async () => {
    const { body } = await login('root')
    const t = body.accessToken
    assert.equal(body.user.mfaSetupRequired, true)
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(t) })).statusCode, 403)
    const setup = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/setup', headers: auth(t) })
    const secret = setup.json().secret as string
    const confirm = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/confirm', headers: auth(t), payload: { code: totpAt(secret, Date.now()) } })
    assert.equal(confirm.statusCode, 200); assert.equal(confirm.json().recoveryCodes.length, 10)
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(t) })).statusCode, 200)
    const step2 = await login('root')
    assert.equal(step2.body.status, 'mfa_required')
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/verify', payload: { challengeToken: step2.body.challengeToken, code: '000000' } })
    assert.equal(wrong.statusCode, 401)
    // the TOTP step used at enrolment cannot be replayed at login
    const replay = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/verify', payload: { challengeToken: step2.body.challengeToken, code: totpAt(secret, Date.now()) } })
    assert.equal(replay.statusCode, 401)
    const recovery = confirm.json().recoveryCodes[0] as string
    const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/verify', payload: { challengeToken: step2.body.challengeToken, code: recovery } })
    assert.equal(ok.statusCode, 200)
  })

  test('audit log captured logins, invites and denials; rows cannot be altered', async () => {
    for (const action of ['auth.login', 'user.invite', 'access.denied']) assert.ok((await db.query(`SELECT 1 FROM audit_logs WHERE action = $1 LIMIT 1`, [action])).rowCount === 1, action)
    await assert.rejects(db.query(`UPDATE audit_logs SET action = 'x'`), /append-only/)
    await assert.rejects(db.query(`DELETE FROM audit_logs`), /append-only/)
  })
})
