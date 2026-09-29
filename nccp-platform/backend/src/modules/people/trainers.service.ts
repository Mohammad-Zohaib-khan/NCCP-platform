import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { buildUpdate, keysetList, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertInstitutionAccess, resolveInstitutionId, scopeInstitutionIds, type AuthContext } from '../../auth/context.js'
import type { AuthService, ReqInfo } from '../auth/service.js'
import { assertInstitutionActive } from '../institutions/service.js'

type Row = Record<string, unknown>
export type TrainerStatus = 'active' | 'inactive' | 'on_leave'
export interface TrainerCreate { email: string; fullName: string; phone?: string; institutionId?: string; designation?: string; qualifications?: string; expertise?: string[]; experienceYears?: number; availability?: Record<string, unknown> }
export interface TrainerPatch { fullName?: string; phone?: string | null; designation?: string | null; qualifications?: string | null; expertise?: string[]; experienceYears?: number | null; availability?: Record<string, unknown>; status?: TrainerStatus }
export interface TrainerSelfPatch { availability?: Record<string, unknown>; expertise?: string[]; qualifications?: string | null }
export interface TrainerFilter { q?: string; status?: TrainerStatus; institutionId?: string; expertise?: string }

const COLS = `t.id, t.user_id, t.institution_id, i.name AS institution_name, u.full_name, u.email, u.phone, u.status AS user_status,
  t.designation, t.qualifications, t.expertise, t.experience_years, t.availability, t.status, t.created_at, t.version,
  (SELECT count(*)::int FROM batches b WHERE b.trainer_id = t.id AND b.deleted_at IS NULL AND b.status IN ('planned','ongoing')) AS active_batches`
const FROM = `trainers t JOIN users u ON u.id = t.user_id JOIN institutions i ON i.id = t.institution_id`

export const toTrainerDto = (r: Row) => ({
  id: r.id as string, userId: r.user_id as string, institutionId: r.institution_id as string, institutionName: r.institution_name as string,
  fullName: r.full_name as string, email: r.email as string, phone: (r.phone as string | null) ?? null, userStatus: r.user_status as string,
  designation: (r.designation as string | null) ?? null, qualifications: (r.qualifications as string | null) ?? null, expertise: r.expertise as string[],
  experienceYears: (r.experience_years as number | null) ?? null, availability: r.availability as Record<string, unknown>, status: r.status as TrainerStatus,
  activeBatches: r.active_batches as number, createdAt: r.created_at as Date, version: r.version as number,
})

export function createTrainersService(db: Db, auth: AuthService) {
  /** Load (optionally locking) a trainer the actor may see; 404 when missing or out of scope. */
  async function load(actor: AuthContext, id: string, client: Db | Tx = db, lock = false): Promise<Row> {
    const r = await client.query(`SELECT ${COLS} FROM ${FROM} WHERE t.id = $1 AND t.deleted_at IS NULL${lock ? ' FOR UPDATE OF t' : ''}`, [id])
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('Trainer')
    assertInstitutionAccess(actor, row.institution_id as string, 'Trainer')
    return row
  }
  async function loadOwn(actor: AuthContext, client: Db | Tx = db, lock = false): Promise<Row> {
    const r = await client.query(`SELECT ${COLS} FROM ${FROM} WHERE t.user_id = $1 AND t.deleted_at IS NULL${lock ? ' FOR UPDATE OF t' : ''}`, [actor.userId])
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('Trainer profile')
    return row
  }

  async function list(actor: AuthContext, f: TrainerFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['t.deleted_at IS NULL']
    const ids = scopeInstitutionIds(actor, f.institutionId)
    if (ids) { params.push(ids); where.push(`t.institution_id = ANY($${params.length}::uuid[])`) }
    if (f.status) { params.push(f.status); where.push(`t.status = $${params.length}`) }
    if (f.expertise) { params.push(f.expertise); where.push(`EXISTS (SELECT 1 FROM unnest(t.expertise) e WHERE lower(e) = lower($${params.length}::text))`) }
    if (f.q) { params.push(likePattern(f.q)); where.push(`(u.full_name ILIKE $${params.length} OR u.email::text ILIKE $${params.length})`) }
    return keysetList(db, { select: COLS, from: FROM, where, params, sort, idExpr: 't.id', page, map: toTrainerDto })
  }

  async function get(actor: AuthContext, id: string) { return toTrainerDto(await load(actor, id)) }
  async function getOwn(actor: AuthContext) { return toTrainerDto(await loadOwn(actor)) }

  /** Creates the user (invited), the trainer profile and an invitation token in one transaction; the mail goes out after commit. */
  async function create(actor: AuthContext, input: TrainerCreate, info: ReqInfo) {
    const institutionId = resolveInstitutionId(actor, input.institutionId)
    const email = input.email.trim().toLowerCase()
    const created = await withTransaction(db, async (tx) => {
      await assertInstitutionActive(tx, institutionId)
      let userId: string
      try {
        userId = ((await tx.query(`INSERT INTO users (email, full_name, phone, role_code, status) VALUES ($1,$2,$3,'trainer','invited') RETURNING id`, [email, input.fullName.trim(), input.phone ?? null])).rows[0] as Row).id as string
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw AppError.conflict('A user with this email already exists')
        throw err
      }
      const t = await tx.query(
        `INSERT INTO trainers (user_id, institution_id, designation, qualifications, expertise, experience_years, availability) VALUES ($1,$2,$3,$4,$5::text[],$6,$7::jsonb) RETURNING id`,
        [userId, institutionId, input.designation ?? null, input.qualifications ?? null, input.expertise ?? [], input.experienceYears ?? null, JSON.stringify(input.availability ?? {})])
      const trainerId = (t.rows[0] as Row).id as string
      const token = await auth.createUserToken(tx, userId, 'invitation', auth.INVITE_TTL_MIN, actor.userId)
      await writeAudit(tx, { action: 'trainer.create', actorUserId: actor.userId, actorRole: actor.role, entityType: 'trainer', entityId: trainerId, institutionId, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes: { email, userId } })
      return { trainerId, token }
    })
    // After commit: a mail failure must not roll the trainer back; the invitation can be re-sent from /users/:id/resend-invitation.
    let emailSent = true
    try { await auth.sendInvitationEmail(email, input.fullName, created.token, auth.INVITE_TTL_MIN / 60) } catch { emailSent = false }
    return { trainer: await get(actor, created.trainerId), emailSent }
  }

  async function update(actor: AuthContext, id: string, patch: TrainerPatch, expectedVersion: number, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const current = await load(actor, id, tx, true)
      const q = buildUpdate({
        table: 'trainers', id, expectedVersion, jsonColumns: ['availability'], returning: 'id',
        sets: { designation: patch.designation, qualifications: patch.qualifications, expertise: patch.expertise, experience_years: patch.experienceYears, availability: patch.availability, status: patch.status },
      })
      if (!(await tx.query(q.sql, q.params)).rows[0]) throw AppError.preconditionFailed()
      if (patch.fullName !== undefined || patch.phone !== undefined)
        await tx.query(`UPDATE users SET full_name = COALESCE($2, full_name), phone = CASE WHEN $3::boolean THEN $4::text ELSE phone END WHERE id = $1`, [current.user_id, patch.fullName ?? null, patch.phone !== undefined, patch.phone ?? null])
      await writeAudit(tx, { action: 'trainer.update', actorUserId: actor.userId, actorRole: actor.role, entityType: 'trainer', entityId: id, institutionId: current.institution_id as string, requestId: info.requestId, ip: info.ip, changes: { fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) } })
    })
    return get(actor, id)
  }

  /** A trainer edits only availability, expertise and qualifications of their own profile. */
  async function updateOwn(actor: AuthContext, patch: TrainerSelfPatch, expectedVersion: number, info: ReqInfo) {
    let id = ''
    await withTransaction(db, async (tx) => {
      const current = await loadOwn(actor, tx, true)
      id = current.id as string
      const q = buildUpdate({ table: 'trainers', id, expectedVersion, jsonColumns: ['availability'], returning: 'id', sets: { availability: patch.availability, expertise: patch.expertise, qualifications: patch.qualifications } })
      if (!(await tx.query(q.sql, q.params)).rows[0]) throw AppError.preconditionFailed()
      await writeAudit(tx, { action: 'trainer.update_self', actorUserId: actor.userId, actorRole: actor.role, entityType: 'trainer', entityId: id, institutionId: current.institution_id as string, requestId: info.requestId, ip: info.ip, changes: { fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) } })
    })
    return get(actor, id)
  }

  /** Soft delete: disables the account, ends its sessions, and is refused while the trainer still has planned/ongoing batches. */
  async function remove(actor: AuthContext, id: string, info: ReqInfo): Promise<void> {
    await withTransaction(db, async (tx) => {
      const current = await load(actor, id, tx, true)
      const open = await tx.query(`SELECT count(*)::int AS n FROM batches WHERE trainer_id = $1 AND deleted_at IS NULL AND status IN ('planned','ongoing')`, [id])
      const n = (open.rows[0] as Row).n as number
      if (n > 0) throw AppError.conflict('The trainer is assigned to planned or ongoing batches; reassign them first', { batches: n })
      await tx.query(`UPDATE trainers SET deleted_at = now() WHERE id = $1`, [id])
      await tx.query(`UPDATE users SET status = 'disabled', deleted_at = now() WHERE id = $1`, [current.user_id])
      await tx.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'user_deleted' WHERE user_id = $1 AND revoked_at IS NULL`, [current.user_id])
      await writeAudit(tx, { action: 'trainer.delete', actorUserId: actor.userId, actorRole: actor.role, entityType: 'trainer', entityId: id, institutionId: current.institution_id as string, requestId: info.requestId, ip: info.ip })
    })
  }

  return { list, get, getOwn, create, update, updateOwn, remove }
}
export type TrainersService = ReturnType<typeof createTrainersService>
