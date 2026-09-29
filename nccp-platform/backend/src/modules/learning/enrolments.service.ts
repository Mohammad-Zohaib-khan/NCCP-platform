import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { scopeInstitutionIds, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { assertInstitutionActive } from '../institutions/service.js'
import { auditBase, loadBatch, seatsTaken, traineeIdOfUser, type BatchRow, type Row } from './access.js'
import { ENROLLABLE_BATCH_STATUSES, planEnrolmentTransition, REENROLLABLE, STAFF_ACTIONS, type EnrolmentAction, type EnrolmentStatus } from './enrolments.state.js'

export interface EnrolmentFilter { batchId?: string; traineeId?: string; status?: EnrolmentStatus; q?: string; institutionId?: string }

const COLS = `e.id, e.batch_id, b.code AS batch_code, p.title AS programme_title, b.institution_id, e.trainee_id, u.full_name AS trainee_name,
  e.status, e.progress_percent::float8 AS progress_percent, e.enrolled_at, e.completed_at, e.final_score::float8 AS final_score, e.version, e.created_at`
const FROM = `batch_enrolments e JOIN batches b ON b.id = e.batch_id JOIN programmes p ON p.id = b.programme_id
  JOIN trainees t ON t.id = e.trainee_id JOIN users u ON u.id = t.user_id`

export const toEnrolmentDto = (r: Row) => ({
  id: r.id as string, batchId: r.batch_id as string, batchCode: r.batch_code as string, programmeTitle: r.programme_title as string,
  institutionId: r.institution_id as string, traineeId: r.trainee_id as string, traineeName: r.trainee_name as string,
  status: r.status as EnrolmentStatus, progressPercent: r.progress_percent as number, enrolledAt: r.enrolled_at as Date,
  completedAt: (r.completed_at as Date | null) ?? null, finalScore: (r.final_score as number | null) ?? null, version: r.version as number, createdAt: r.created_at as Date,
})

export function createEnrolmentsService(db: Db) {
  function visibility(actor: AuthContext, params: unknown[]): string {
    if (actor.role === 'super_admin') return 'TRUE'
    if (actor.role === 'institution_admin') { params.push(actor.institutionIds); return `b.institution_id = ANY($${params.length}::uuid[])` }
    if (actor.role === 'trainer') { params.push(actor.userId); return `EXISTS (SELECT 1 FROM trainers tr WHERE tr.id = b.trainer_id AND tr.user_id = $${params.length})` }
    if (actor.role === 'trainee') { params.push(actor.userId); return `t.user_id = $${params.length}` }
    return 'FALSE'
  }

  async function list(actor: AuthContext, f: EnrolmentFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['b.deleted_at IS NULL', 't.deleted_at IS NULL', visibility(actor, params)]
    if (f.institutionId) { const ids = scopeInstitutionIds(actor, f.institutionId); if (ids) { params.push(ids); where.push(`b.institution_id = ANY($${params.length}::uuid[])`) } }
    if (f.batchId) { params.push(f.batchId); where.push(`e.batch_id = $${params.length}::uuid`) }
    if (f.traineeId) { params.push(f.traineeId); where.push(`e.trainee_id = $${params.length}::uuid`) }
    if (f.status) { params.push(f.status); where.push(`e.status = $${params.length}`) }
    if (f.q) { params.push(likePattern(f.q)); where.push(`u.full_name ILIKE $${params.length}`) }
    return keysetList(db, { select: COLS, from: FROM, where, params, sort, idExpr: 'e.id', page, map: toEnrolmentDto })
  }

  async function get(actor: AuthContext, id: string, client: Db | Tx = db) {
    const params: unknown[] = [id]
    const r = await client.query(`SELECT ${COLS} FROM ${FROM} WHERE e.id = $1 AND b.deleted_at IS NULL AND t.deleted_at IS NULL AND ${visibility(actor, params)}`, params)
    if (!r.rows[0]) throw AppError.notFound('Enrolment')
    return toEnrolmentDto(r.rows[0] as Row)
  }

  function assertEnrollable(b: BatchRow, allowed: readonly string[] = ENROLLABLE_BATCH_STATUSES): void {
    if (!allowed.includes(b.status)) throw AppError.conflict(`A ${b.status} batch does not accept enrolments`)
  }
  /** Caller must hold the batch row lock. Counts seats with the same statuses batch edits use. */
  async function assertSeatFree(tx: Tx, b: BatchRow): Promise<void> {
    const taken = await seatsTaken(tx, b.id)
    if (taken >= b.capacity) throw AppError.conflict('The batch is full', { capacity: b.capacity, enrolled: taken })
  }

  /** Institution admin / super admin enrols a trainee directly (status enrolled). Capacity is enforced under the batch lock. */
  async function enrol(actor: AuthContext, input: { batchId: string; traineeId: string }, info: ReqInfo) {
    const id = await withTransaction(db, async (tx) => {
      const batch = await loadBatch(tx, actor, input.batchId, 'manage', true)
      assertEnrollable(batch)
      await assertInstitutionActive(tx, batch.institutionId)
      const t = (await tx.query(`SELECT id, institution_id, status FROM trainees WHERE id = $1 AND deleted_at IS NULL`, [input.traineeId])).rows[0] as Row | undefined
      if (!t || t.status !== 'active' || t.institution_id !== batch.institutionId)
        throw AppError.validation([{ path: 'traineeId', message: 'Trainee not found, not active, or not part of the batch institution' }])
      const existing = (await tx.query(`SELECT id, status FROM batch_enrolments WHERE batch_id = $1 AND trainee_id = $2 FOR UPDATE`, [batch.id, input.traineeId])).rows[0] as Row | undefined
      if (existing && !REENROLLABLE.includes(existing.status as EnrolmentStatus))
        throw AppError.conflict(existing.status === 'applied' ? 'The trainee has a pending application; approve it instead' : `The trainee is already ${String(existing.status)} in this batch`)
      await assertSeatFree(tx, batch)
      let enrolmentId: string
      if (existing) {
        enrolmentId = existing.id as string
        await tx.query(`UPDATE batch_enrolments SET status = 'enrolled', enrolled_at = now(), completed_at = NULL, final_score = NULL, progress_percent = 0 WHERE id = $1`, [enrolmentId])
      } else {
        enrolmentId = ((await tx.query(`INSERT INTO batch_enrolments (batch_id, trainee_id, status) VALUES ($1,$2,'enrolled') RETURNING id`, [batch.id, input.traineeId])).rows[0] as Row).id as string
      }
      await writeAudit(tx, { ...auditBase(actor, info), action: 'enrolment.enrol', entityType: 'enrolment', entityId: enrolmentId, institutionId: batch.institutionId, changes: { batchId: batch.id, traineeId: input.traineeId, reenrolled: !!existing } })
      return enrolmentId
    })
    return get(actor, id)
  }

  /** A trainee applies to a planned batch of their own institution (status applied; does not take a seat until approved). */
  async function apply(actor: AuthContext, input: { batchId: string }, info: ReqInfo) {
    const id = await withTransaction(db, async (tx) => {
      const traineeId = await traineeIdOfUser(tx, actor.userId)
      if (!traineeId) throw AppError.forbidden('Only trainees can apply to a batch')
      const t = (await tx.query(`SELECT institution_id, status FROM trainees WHERE id = $1`, [traineeId])).rows[0] as Row
      const b = (await tx.query(`SELECT id, institution_id, status FROM batches WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [input.batchId])).rows[0] as Row | undefined
      // A batch of another institution, or one that is not open, looks the same as one that does not exist.
      if (!b || b.institution_id !== t.institution_id || b.status !== 'planned') throw AppError.notFound('Batch')
      if (t.status !== 'active') throw AppError.conflict('Your trainee profile is not active')
      await assertInstitutionActive(tx, b.institution_id as string)
      const existing = (await tx.query(`SELECT id, status FROM batch_enrolments WHERE batch_id = $1 AND trainee_id = $2 FOR UPDATE`, [input.batchId, traineeId])).rows[0] as Row | undefined
      if (existing && !REENROLLABLE.includes(existing.status as EnrolmentStatus)) throw AppError.conflict(`You already have a ${String(existing.status)} enrolment in this batch`)
      let enrolmentId: string
      if (existing) {
        enrolmentId = existing.id as string
        await tx.query(`UPDATE batch_enrolments SET status = 'applied', enrolled_at = now(), completed_at = NULL, final_score = NULL, progress_percent = 0 WHERE id = $1`, [enrolmentId])
      } else {
        enrolmentId = ((await tx.query(`INSERT INTO batch_enrolments (batch_id, trainee_id, status) VALUES ($1,$2,'applied') RETURNING id`, [input.batchId, traineeId])).rows[0] as Row).id as string
      }
      await writeAudit(tx, { ...auditBase(actor, info), action: 'enrolment.apply', entityType: 'enrolment', entityId: enrolmentId, institutionId: b.institution_id as string, changes: { batchId: input.batchId } })
      return enrolmentId
    })
    return get(actor, id)
  }

  /** approve | reject | start | complete | drop (staff) and withdraw (the trainee's own action). */
  async function transition(actor: AuthContext, id: string, action: EnrolmentAction, extra: { reason?: string; finalScore?: number }, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const meta = (await tx.query(
        `SELECT e.batch_id, t.user_id, b.institution_id FROM batch_enrolments e JOIN batches b ON b.id = e.batch_id JOIN trainees t ON t.id = e.trainee_id
         WHERE e.id = $1 AND b.deleted_at IS NULL AND t.deleted_at IS NULL`, [id])).rows[0] as Row | undefined
      if (!meta) throw AppError.notFound('Enrolment')
      let batch: BatchRow | null = null
      if (action === 'withdraw') {
        if (actor.role !== 'trainee' || meta.user_id !== actor.userId) throw AppError.notFound('Enrolment')
        await tx.query(`SELECT 1 FROM batches WHERE id = $1 FOR UPDATE`, [meta.batch_id])
      } else {
        if (!STAFF_ACTIONS.includes(action)) throw AppError.forbidden()
        batch = await loadBatch(tx, actor, meta.batch_id as string, 'manage', true)
      }
      const cur = (await tx.query(`SELECT status FROM batch_enrolments WHERE id = $1 FOR UPDATE`, [id])).rows[0] as Row
      const from = cur.status as EnrolmentStatus
      const to = planEnrolmentTransition(from, action, { reason: extra.reason })
      if (batch && action === 'approve') {
        assertEnrollable(batch)
        await assertInstitutionActive(tx, batch.institutionId)
        await assertSeatFree(tx, batch)
      }
      if (batch && action === 'complete' && !['ongoing', 'completed'].includes(batch.status)) throw AppError.conflict('An enrolment can only be completed once the batch has started')
      if (action === 'complete') await tx.query(`UPDATE batch_enrolments SET status = $2, completed_at = now(), final_score = $3 WHERE id = $1`, [id, to, extra.finalScore ?? null])
      else await tx.query(`UPDATE batch_enrolments SET status = $2 WHERE id = $1`, [id, to])
      await writeAudit(tx, { ...auditBase(actor, info), action: `enrolment.${action}`, entityType: 'enrolment', entityId: id, institutionId: meta.institution_id as string, changes: { from, to, reason: extra.reason, finalScore: extra.finalScore } })
    })
    return get(actor, id)
  }

  return { list, get, enrol, apply, transition }
}
export type EnrolmentsService = ReturnType<typeof createEnrolmentsService>
