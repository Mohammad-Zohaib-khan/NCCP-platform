import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { buildUpdate, keysetList, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertInstitutionAccess, isSuperAdmin, resolveInstitutionId, scopeInstitutionIds, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { assertInstitutionActive } from '../institutions/service.js'
import { CAPACITY_STATUSES, capacityStatusesSql } from './constants.js'
import { isBatchClosed, planBatchTransition, validateBatchDates, validateCapacity, type BatchStatus } from './batches.state.js'

/** Re-exported so Part 4 (enrolments) counts seats with exactly the same statuses. */
export { CAPACITY_STATUSES }

type Row = Record<string, unknown>
export type BatchMode = 'offline' | 'online' | 'hybrid'
export interface BatchCreate { code: string; programmeId: string; institutionId?: string; trainerId?: string | null; startDate: string; endDate: string; capacity: number; schedule?: string | null; mode?: BatchMode }
export interface BatchPatch { code?: string; startDate?: string; endDate?: string; capacity?: number; schedule?: string | null; mode?: BatchMode }
export interface BatchFilter { q?: string; status?: BatchStatus; programmeId?: string; trainerId?: string; mode?: BatchMode; institutionId?: string; startFrom?: string; startTo?: string }

const COLS = `b.id, b.code, b.programme_id, p.title AS programme_title, b.institution_id, i.name AS institution_name, b.trainer_id, tu.full_name AS trainer_name,
  b.start_date::text AS start_date, b.end_date::text AS end_date, b.capacity, b.schedule, b.mode, b.status, b.created_at, b.version,
  (SELECT count(*)::int FROM batch_enrolments e WHERE e.batch_id = b.id AND e.status IN (${capacityStatusesSql()})) AS enrolled_count`
const FROM = `batches b JOIN programmes p ON p.id = b.programme_id JOIN institutions i ON i.id = b.institution_id
  LEFT JOIN trainers tr ON tr.id = b.trainer_id LEFT JOIN users tu ON tu.id = tr.user_id`

export const toBatchDto = (r: Row) => {
  const capacity = r.capacity as number
  const enrolled = r.enrolled_count as number
  return {
    id: r.id as string, code: r.code as string, programmeId: r.programme_id as string, programmeTitle: r.programme_title as string,
    institutionId: r.institution_id as string, institutionName: r.institution_name as string,
    trainerId: (r.trainer_id as string | null) ?? null, trainerName: (r.trainer_name as string | null) ?? null,
    startDate: r.start_date as string, endDate: r.end_date as string, capacity, enrolledCount: enrolled, seatsLeft: Math.max(capacity - enrolled, 0),
    schedule: (r.schedule as string | null) ?? null, mode: r.mode as BatchMode, status: r.status as BatchStatus, createdAt: r.created_at as Date, version: r.version as number,
  }
}

export function createBatchesService(db: Db) {
  /**
   * Super admin: all. Institution admin: own institutions. Trainer: only batches assigned to them.
   * Trainee: batches they are enrolled in, plus planned batches of their own institution. Employers see none.
   */
  function visibility(actor: AuthContext, params: unknown[]): string {
    if (isSuperAdmin(actor)) return 'TRUE'
    if (actor.role === 'institution_admin') { params.push(actor.institutionIds); return `b.institution_id = ANY($${params.length}::uuid[])` }
    if (actor.role === 'trainer') { params.push(actor.userId); return `tr.user_id = $${params.length}` }
    if (actor.role === 'trainee') {
      params.push(actor.userId, actor.institutionIds)
      return `(EXISTS (SELECT 1 FROM batch_enrolments e JOIN trainees t ON t.id = e.trainee_id WHERE e.batch_id = b.id AND t.user_id = $${params.length - 1})
               OR (b.status = 'planned' AND b.institution_id = ANY($${params.length}::uuid[])))`
    }
    return 'FALSE'
  }

  async function load(actor: AuthContext, id: string, client: Db | Tx = db, lock = false): Promise<Row> {
    const params: unknown[] = [id]
    const vis = visibility(actor, params)
    const r = await client.query(`SELECT ${COLS} FROM ${FROM} WHERE b.id = $1 AND b.deleted_at IS NULL AND ${vis}${lock ? ' FOR UPDATE OF b' : ''}`, params)
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('Batch')
    return row
  }
  /** Writes need the batch's own institution (or super admin); a trainer who can read a batch still may not write it. */
  function assertCanWrite(actor: AuthContext, row: Row): void {
    if (actor.role !== 'super_admin' && actor.role !== 'institution_admin') throw AppError.forbidden()
    assertInstitutionAccess(actor, row.institution_id as string, 'Batch')
  }

  async function assertTrainerAssignable(tx: Tx, trainerId: string, institutionId: string): Promise<void> {
    const r = await tx.query(`SELECT status, institution_id FROM trainers WHERE id = $1 AND deleted_at IS NULL`, [trainerId])
    const t = r.rows[0] as Row | undefined
    if (!t || t.institution_id !== institutionId || t.status !== 'active')
      throw AppError.validation([{ path: 'trainerId', message: 'Trainer not found, not active, or not part of this institution' }])
  }
  const occupiedSeats = async (tx: Tx, batchId: string): Promise<number> =>
    ((await tx.query(`SELECT count(*)::int AS n FROM batch_enrolments WHERE batch_id = $1 AND status IN (${capacityStatusesSql()})`, [batchId])).rows[0] as Row).n as number
  const dupCode = (err: unknown): never => {
    if ((err as { code?: string }).code === '23505') throw AppError.conflict('A batch with this code already exists in this institution')
    throw err
  }

  async function list(actor: AuthContext, f: BatchFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['b.deleted_at IS NULL', visibility(actor, params)]
    if (f.institutionId) {
      const ids = scopeInstitutionIds(actor, f.institutionId)
      if (ids) { params.push(ids); where.push(`b.institution_id = ANY($${params.length}::uuid[])`) }
    }
    if (f.status) { params.push(f.status); where.push(`b.status = $${params.length}`) }
    if (f.programmeId) { params.push(f.programmeId); where.push(`b.programme_id = $${params.length}::uuid`) }
    if (f.trainerId) { params.push(f.trainerId); where.push(`b.trainer_id = $${params.length}::uuid`) }
    if (f.mode) { params.push(f.mode); where.push(`b.mode = $${params.length}`) }
    if (f.startFrom) { params.push(f.startFrom); where.push(`b.start_date >= $${params.length}::date`) }
    if (f.startTo) { params.push(f.startTo); where.push(`b.start_date <= $${params.length}::date`) }
    if (f.q) { params.push(likePattern(f.q)); where.push(`(b.code ILIKE $${params.length} OR p.title ILIKE $${params.length})`) }
    return keysetList(db, { select: COLS, from: FROM, where, params, sort, idExpr: 'b.id', page, map: toBatchDto })
  }

  async function get(actor: AuthContext, id: string) { return toBatchDto(await load(actor, id)) }

  async function create(actor: AuthContext, input: BatchCreate, info: ReqInfo) {
    const institutionId = resolveInstitutionId(actor, input.institutionId)
    validateBatchDates(input.startDate, input.endDate)
    validateCapacity(input.capacity, 0)
    const id = await withTransaction(db, async (tx) => {
      await assertInstitutionActive(tx, institutionId)
      const prog = ((await tx.query(`SELECT status, institution_id FROM programmes WHERE id = $1 AND deleted_at IS NULL`, [input.programmeId])).rows[0]) as Row | undefined
      const usable = prog && prog.status === 'active' && (prog.institution_id == null || prog.institution_id === institutionId)
      if (!usable) throw AppError.validation([{ path: 'programmeId', message: 'Programme not found, not active, or not available to this institution' }])
      if (input.trainerId) await assertTrainerAssignable(tx, input.trainerId, institutionId)
      let newId: string
      try {
        newId = ((await tx.query(
          `INSERT INTO batches (code, programme_id, institution_id, trainer_id, start_date, end_date, capacity, schedule, mode)
           VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9) RETURNING id`,
          [input.code.trim(), input.programmeId, institutionId, input.trainerId ?? null, input.startDate, input.endDate, input.capacity, input.schedule ?? null, input.mode ?? 'offline'])).rows[0] as Row).id as string
      } catch (err) { return dupCode(err) }
      await writeAudit(tx, { action: 'batch.create', actorUserId: actor.userId, actorRole: actor.role, entityType: 'batch', entityId: newId, institutionId, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes: { code: input.code, programmeId: input.programmeId, capacity: input.capacity } })
      return newId
    })
    return get(actor, id)
  }

  /** Locks the batch row (Part 4 enrolment locks the same row), so the capacity check cannot race with a new enrolment. */
  async function update(actor: AuthContext, id: string, patch: BatchPatch, expectedVersion: number, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const current = await load(actor, id, tx, true)
      assertCanWrite(actor, current)
      if (isBatchClosed(current.status as BatchStatus)) throw AppError.conflict(`A ${String(current.status)} batch cannot be edited`)
      if ((current.version as number) !== expectedVersion) throw AppError.preconditionFailed()
      validateBatchDates(patch.startDate ?? (current.start_date as string), patch.endDate ?? (current.end_date as string))
      if (patch.capacity !== undefined) validateCapacity(patch.capacity, await occupiedSeats(tx, id))
      const q = buildUpdate({ table: 'batches', id, expectedVersion, returning: 'id',
        sets: { code: patch.code?.trim(), start_date: patch.startDate, end_date: patch.endDate, capacity: patch.capacity, schedule: patch.schedule, mode: patch.mode } })
      let res
      try { res = await tx.query(q.sql, q.params) } catch (err) { return dupCode(err) }
      if (!res.rows[0]) throw AppError.preconditionFailed()
      await writeAudit(tx, { action: 'batch.update', actorUserId: actor.userId, actorRole: actor.role, entityType: 'batch', entityId: id, institutionId: current.institution_id as string, requestId: info.requestId, ip: info.ip, changes: { fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) } })
    })
    return get(actor, id)
  }

  async function transition(actor: AuthContext, id: string, target: BatchStatus, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const current = await load(actor, id, tx, true)
      assertCanWrite(actor, current)
      const to = planBatchTransition(current.status as BatchStatus, target, { hasTrainer: current.trainer_id != null })
      await tx.query(`UPDATE batches SET status = $2 WHERE id = $1`, [id, to])
      await writeAudit(tx, { action: `batch.${to}`, actorUserId: actor.userId, actorRole: actor.role, entityType: 'batch', entityId: id, institutionId: current.institution_id as string, requestId: info.requestId, ip: info.ip, changes: { from: current.status, to } })
    })
    return get(actor, id)
  }

  /** PUT /batches/:id/trainer: assign a trainer or clear it (null). An ongoing batch must keep a trainer. */
  async function setTrainer(actor: AuthContext, id: string, trainerId: string | null, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const current = await load(actor, id, tx, true)
      assertCanWrite(actor, current)
      if (isBatchClosed(current.status as BatchStatus)) throw AppError.conflict(`A ${String(current.status)} batch cannot change trainer`)
      if (trainerId === null && current.status === 'ongoing') throw AppError.conflict('An ongoing batch must have a trainer')
      if (trainerId) await assertTrainerAssignable(tx, trainerId, current.institution_id as string)
      await tx.query(`UPDATE batches SET trainer_id = $2 WHERE id = $1`, [id, trainerId])
      await writeAudit(tx, { action: 'batch.assign_trainer', actorUserId: actor.userId, actorRole: actor.role, entityType: 'batch', entityId: id, institutionId: current.institution_id as string, requestId: info.requestId, ip: info.ip, changes: { from: current.trainer_id, to: trainerId } })
    })
    return get(actor, id)
  }

  async function remove(actor: AuthContext, id: string, info: ReqInfo): Promise<void> {
    await withTransaction(db, async (tx) => {
      const current = await load(actor, id, tx, true)
      assertCanWrite(actor, current)
      const n = ((await tx.query(`SELECT count(*)::int AS n FROM batch_enrolments WHERE batch_id = $1`, [id])).rows[0] as Row).n as number
      if (n > 0) throw AppError.conflict('The batch has enrolments and cannot be deleted; cancel it instead', { enrolments: n })
      await tx.query(`UPDATE batches SET deleted_at = now() WHERE id = $1`, [id])
      await writeAudit(tx, { action: 'batch.delete', actorUserId: actor.userId, actorRole: actor.role, entityType: 'batch', entityId: id, institutionId: current.institution_id as string, requestId: info.requestId, ip: info.ip })
    })
  }

  return { list, get, create, update, transition, setTrainer, remove }
}
export type BatchesService = ReturnType<typeof createBatchesService>
