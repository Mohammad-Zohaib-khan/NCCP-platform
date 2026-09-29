import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { buildUpdate, keysetList, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { isSuperAdmin, resolveInstitutionId, scopeInstitutionIds, type AuthContext } from '../../auth/context.js'
import type { AuthService, ReqInfo } from '../auth/service.js'
import { assertInstitutionActive } from '../institutions/service.js'
import { capacityStatusesSql } from '../training/constants.js'

type Row = Record<string, unknown>
export type TraineeStatus = 'active' | 'inactive' | 'graduated' | 'dropped'
export type Gender = 'female' | 'male' | 'other' | 'undisclosed'
export interface TraineeProfile { gender?: Gender | null; dateOfBirth?: string | null; state?: string | null; district?: string | null; location?: string | null; education?: string | null; skills?: string[]; careerProfile?: Record<string, unknown>; openToWork?: boolean }
export interface TraineeCreate extends TraineeProfile { email: string; fullName: string; phone?: string; institutionId?: string }
export interface TraineePatch extends TraineeProfile { fullName?: string; phone?: string | null; status?: TraineeStatus }
export interface TraineeSelfPatch { skills?: string[]; careerProfile?: Record<string, unknown>; openToWork?: boolean; location?: string | null; education?: string | null }
export interface TraineeFilter { q?: string; status?: TraineeStatus; institutionId?: string; state?: string; skill?: string; openToWork?: boolean }

const COLS = `t.id, t.user_id, t.institution_id, i.name AS institution_name, u.full_name, u.email, u.phone, u.status AS user_status,
  t.gender, t.date_of_birth::text AS date_of_birth, t.state, t.district, t.location, t.education, t.skills, t.career_profile, t.open_to_work, t.status, t.created_at, t.version`
const FROM = `trainees t JOIN users u ON u.id = t.user_id LEFT JOIN institutions i ON i.id = t.institution_id`

/** Trainers see a reduced record: date of birth and phone are removed. */
export function toTraineeDto(r: Row, restricted: boolean) {
  return {
    id: r.id as string, userId: r.user_id as string, institutionId: (r.institution_id as string | null) ?? null, institutionName: (r.institution_name as string | null) ?? null,
    fullName: r.full_name as string, email: r.email as string, userStatus: r.user_status as string,
    ...(restricted ? {} : { phone: (r.phone as string | null) ?? null, dateOfBirth: (r.date_of_birth as string | null) ?? null }),
    gender: (r.gender as Gender | null) ?? null, state: (r.state as string | null) ?? null, district: (r.district as string | null) ?? null,
    location: (r.location as string | null) ?? null, education: (r.education as string | null) ?? null, skills: r.skills as string[],
    careerProfile: r.career_profile as Record<string, unknown>, openToWork: r.open_to_work as boolean, status: r.status as TraineeStatus,
    createdAt: r.created_at as Date, version: r.version as number,
  }
}

export function createTraineesService(db: Db, auth: AuthService) {
  /** SQL condition for the trainees the caller may see; pushes its bind parameters onto `params`. */
  function visibility(actor: AuthContext, params: unknown[]): string {
    if (isSuperAdmin(actor)) return 'TRUE'
    if (actor.role === 'institution_admin') { params.push(actor.institutionIds); return `t.institution_id = ANY($${params.length}::uuid[])` }
    if (actor.role === 'trainer') {
      params.push(actor.userId)
      return `EXISTS (SELECT 1 FROM batch_enrolments e JOIN batches b ON b.id = e.batch_id JOIN trainers tr ON tr.id = b.trainer_id
                       WHERE e.trainee_id = t.id AND tr.user_id = $${params.length} AND tr.deleted_at IS NULL AND b.deleted_at IS NULL AND e.status IN (${capacityStatusesSql()}))`
    }
    if (actor.role === 'trainee') { params.push(actor.userId); return `t.user_id = $${params.length}` }
    return 'FALSE'
  }
  const restrictedFor = (actor: AuthContext) => actor.role === 'trainer'

  async function load(actor: AuthContext, id: string, client: Db | Tx = db, lock = false): Promise<Row> {
    const params: unknown[] = [id]
    const vis = visibility(actor, params)
    const r = await client.query(`SELECT ${COLS} FROM ${FROM} WHERE t.id = $1 AND t.deleted_at IS NULL AND ${vis}${lock ? ' FOR UPDATE OF t' : ''}`, params)
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('Trainee') // out-of-scope trainees look exactly like missing ones
    return row
  }
  async function loadOwn(actor: AuthContext, client: Db | Tx = db, lock = false): Promise<Row> {
    const r = await client.query(`SELECT ${COLS} FROM ${FROM} WHERE t.user_id = $1 AND t.deleted_at IS NULL${lock ? ' FOR UPDATE OF t' : ''}`, [actor.userId])
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('Trainee profile')
    return row
  }

  async function list(actor: AuthContext, f: TraineeFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['t.deleted_at IS NULL', visibility(actor, params)]
    if (f.institutionId) {
      const ids = scopeInstitutionIds(actor, f.institutionId)
      if (ids) { params.push(ids); where.push(`t.institution_id = ANY($${params.length}::uuid[])`) }
    }
    if (f.status) { params.push(f.status); where.push(`t.status = $${params.length}`) }
    if (f.state) { params.push(f.state); where.push(`t.state = $${params.length}`) }
    if (f.openToWork !== undefined) { params.push(f.openToWork); where.push(`t.open_to_work = $${params.length}`) }
    if (f.skill) { params.push(f.skill); where.push(`EXISTS (SELECT 1 FROM unnest(t.skills) s WHERE lower(s) = lower($${params.length}::text))`) }
    if (f.q) { params.push(likePattern(f.q)); where.push(`(u.full_name ILIKE $${params.length} OR u.email::text ILIKE $${params.length})`) }
    const restricted = restrictedFor(actor)
    return keysetList(db, { select: COLS, from: FROM, where, params, sort, idExpr: 't.id', page, map: (r) => toTraineeDto(r, restricted) })
  }

  async function get(actor: AuthContext, id: string) { return toTraineeDto(await load(actor, id), restrictedFor(actor)) }
  async function getOwn(actor: AuthContext) { return toTraineeDto(await loadOwn(actor), false) }

  async function create(actor: AuthContext, input: TraineeCreate, info: ReqInfo) {
    const institutionId = resolveInstitutionId(actor, input.institutionId)
    const email = input.email.trim().toLowerCase()
    const created = await withTransaction(db, async (tx) => {
      await assertInstitutionActive(tx, institutionId)
      let userId: string
      try {
        userId = ((await tx.query(`INSERT INTO users (email, full_name, phone, role_code, status) VALUES ($1,$2,$3,'trainee','invited') RETURNING id`, [email, input.fullName.trim(), input.phone ?? null])).rows[0] as Row).id as string
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw AppError.conflict('A user with this email already exists')
        throw err
      }
      const t = await tx.query(
        `INSERT INTO trainees (user_id, institution_id, gender, date_of_birth, state, district, location, education, skills, career_profile, open_to_work)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9::text[],$10::jsonb,$11) RETURNING id`,
        [userId, institutionId, input.gender ?? null, input.dateOfBirth ?? null, input.state ?? null, input.district ?? null, input.location ?? null, input.education ?? null,
         input.skills ?? [], JSON.stringify(input.careerProfile ?? {}), input.openToWork ?? true])
      const traineeId = (t.rows[0] as Row).id as string
      const token = await auth.createUserToken(tx, userId, 'invitation', auth.INVITE_TTL_MIN, actor.userId)
      await writeAudit(tx, { action: 'trainee.create', actorUserId: actor.userId, actorRole: actor.role, entityType: 'trainee', entityId: traineeId, institutionId, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes: { email, userId } })
      return { traineeId, token }
    })
    let emailSent = true
    try { await auth.sendInvitationEmail(email, input.fullName, created.token, auth.INVITE_TTL_MIN / 60) } catch { emailSent = false }
    return { trainee: await get(actor, created.traineeId), emailSent }
  }

  async function update(actor: AuthContext, id: string, patch: TraineePatch, expectedVersion: number, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const current = await load(actor, id, tx, true)
      const q = buildUpdate({
        table: 'trainees', id, expectedVersion, jsonColumns: ['career_profile'], returning: 'id',
        sets: { gender: patch.gender, date_of_birth: patch.dateOfBirth, state: patch.state, district: patch.district, location: patch.location, education: patch.education,
          skills: patch.skills, career_profile: patch.careerProfile, open_to_work: patch.openToWork, status: patch.status },
      })
      if (!(await tx.query(q.sql, q.params)).rows[0]) throw AppError.preconditionFailed()
      if (patch.fullName !== undefined || patch.phone !== undefined)
        await tx.query(`UPDATE users SET full_name = COALESCE($2, full_name), phone = CASE WHEN $3::boolean THEN $4::text ELSE phone END WHERE id = $1`, [current.user_id, patch.fullName ?? null, patch.phone !== undefined, patch.phone ?? null])
      await writeAudit(tx, { action: 'trainee.update', actorUserId: actor.userId, actorRole: actor.role, entityType: 'trainee', entityId: id, institutionId: (current.institution_id as string | null) ?? null, requestId: info.requestId, ip: info.ip, changes: { fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) } })
    })
    return get(actor, id)
  }

  /** A trainee edits only skills, career profile, open-to-work, location and education on their own record. */
  async function updateOwn(actor: AuthContext, patch: TraineeSelfPatch, expectedVersion: number, info: ReqInfo) {
    let id = ''
    await withTransaction(db, async (tx) => {
      const current = await loadOwn(actor, tx, true)
      id = current.id as string
      const q = buildUpdate({ table: 'trainees', id, expectedVersion, jsonColumns: ['career_profile'], returning: 'id',
        sets: { skills: patch.skills, career_profile: patch.careerProfile, open_to_work: patch.openToWork, location: patch.location, education: patch.education } })
      if (!(await tx.query(q.sql, q.params)).rows[0]) throw AppError.preconditionFailed()
      await writeAudit(tx, { action: 'trainee.update_self', actorUserId: actor.userId, actorRole: actor.role, entityType: 'trainee', entityId: id, institutionId: (current.institution_id as string | null) ?? null, requestId: info.requestId, ip: info.ip, changes: { fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) } })
    })
    return get(actor, id)
  }

  async function remove(actor: AuthContext, id: string, info: ReqInfo): Promise<void> {
    await withTransaction(db, async (tx) => {
      const current = await load(actor, id, tx, true)
      await tx.query(`UPDATE trainees SET deleted_at = now() WHERE id = $1`, [id])
      await tx.query(`UPDATE users SET status = 'disabled', deleted_at = now() WHERE id = $1`, [current.user_id])
      await tx.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'user_deleted' WHERE user_id = $1 AND revoked_at IS NULL`, [current.user_id])
      await writeAudit(tx, { action: 'trainee.delete', actorUserId: actor.userId, actorRole: actor.role, entityType: 'trainee', entityId: id, institutionId: (current.institution_id as string | null) ?? null, requestId: info.requestId, ip: info.ip })
    })
  }

  return { list, get, getOwn, create, update, updateOwn, remove }
}
export type TraineesService = ReturnType<typeof createTraineesService>
