import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { buildUpdate, keysetList, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { scopeInstitutionIds, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { assertInstitutionActive } from '../institutions/service.js'
import { auditBase, batchVisibilitySql, loadBatch, type BatchRow, type Row } from './access.js'
import { isSessionClosed, planSessionTransition, validateSessionMode, validateSessionTimes, type SessionStatus } from './sessions.state.js'

export type SessionMode = 'offline' | 'online'
export interface SessionFilter { batchId?: string; trainerId?: string; status?: SessionStatus; mode?: SessionMode; from?: string; to?: string; institutionId?: string; q?: string }
export interface SessionCreate { batchId: string; title: string; startsAt: string; endsAt: string; mode?: SessionMode; joinUrl?: string | null; location?: string | null }
export interface SessionPatch { title?: string; startsAt?: string; endsAt?: string; mode?: SessionMode; joinUrl?: string | null; location?: string | null }

const COLS = `s.id, s.batch_id, b.code AS batch_code, p.title AS programme_title, b.institution_id, b.trainer_id, s.title, s.starts_at, s.ends_at, s.mode,
  s.join_url, s.location, s.status, s.attendance_opened_at, s.attendance_closed_at, s.version, s.created_at`
const FROM = `class_sessions s JOIN batches b ON b.id = s.batch_id JOIN programmes p ON p.id = b.programme_id LEFT JOIN trainers tr ON tr.id = b.trainer_id`

export const toSessionDto = (r: Row) => ({
  id: r.id as string, batchId: r.batch_id as string, batchCode: r.batch_code as string, programmeTitle: r.programme_title as string, institutionId: r.institution_id as string,
  trainerId: (r.trainer_id as string | null) ?? null, title: r.title as string, startsAt: r.starts_at as Date, endsAt: r.ends_at as Date, mode: r.mode as SessionMode,
  joinUrl: (r.join_url as string | null) ?? null, location: (r.location as string | null) ?? null, status: r.status as SessionStatus, attendanceOpen: Boolean(r.attendance_opened_at) && !r.attendance_closed_at, version: r.version as number, createdAt: r.created_at as Date,
})

const TIMETABLE_MAX_DAYS = 93
const TIMETABLE_MAX_ROWS = 500

export function createSessionsService(db: Db) {
  async function list(actor: AuthContext, f: SessionFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['b.deleted_at IS NULL', batchVisibilitySql(actor, params)]
    if (f.institutionId) { const ids = scopeInstitutionIds(actor, f.institutionId); if (ids) { params.push(ids); where.push(`b.institution_id = ANY($${params.length}::uuid[])`) } }
    if (f.batchId) { params.push(f.batchId); where.push(`s.batch_id = $${params.length}::uuid`) }
    if (f.trainerId) { params.push(f.trainerId); where.push(`b.trainer_id = $${params.length}::uuid`) }
    if (f.status) { params.push(f.status); where.push(`s.status = $${params.length}`) }
    if (f.mode) { params.push(f.mode); where.push(`s.mode = $${params.length}`) }
    if (f.from) { params.push(f.from); where.push(`s.starts_at >= $${params.length}::timestamptz`) }
    if (f.to) { params.push(f.to); where.push(`s.starts_at < $${params.length}::timestamptz`) }
    if (f.q) { params.push(likePattern(f.q)); where.push(`s.title ILIKE $${params.length}`) }
    return keysetList(db, { select: COLS, from: FROM, where, params, sort, idExpr: 's.id', page, map: toSessionDto })
  }

  /** Calendar view: every session starting in [from, to), soonest first, in one response (no cursor). */
  async function timetable(actor: AuthContext, f: SessionFilter & { from: string; to: string }) {
    const span = Date.parse(f.to) - Date.parse(f.from)
    if (!(span > 0)) throw AppError.validation([{ path: 'to', message: 'to must be after from' }])
    if (span > TIMETABLE_MAX_DAYS * 86_400_000) throw AppError.validation([{ path: 'to', message: `The timetable range cannot exceed ${TIMETABLE_MAX_DAYS} days` }])
    const res = await list(actor, f, { key: 'starts_at', expr: 's.starts_at', type: 'timestamptz', dir: 'ASC' }, { limit: TIMETABLE_MAX_ROWS })
    return { data: res.data, truncated: res.page.hasMore }
  }

  async function loadSession(actor: AuthContext, id: string, client: Db | Tx = db): Promise<Row> {
    const params: unknown[] = [id]
    const r = await client.query(`SELECT ${COLS} FROM ${FROM} WHERE s.id = $1 AND b.deleted_at IS NULL AND ${batchVisibilitySql(actor, params)}`, params)
    if (!r.rows[0]) throw AppError.notFound('Session')
    return r.rows[0] as Row
  }
  const get = async (actor: AuthContext, id: string) => toSessionDto(await loadSession(actor, id))

  /**
   * A trainer cannot teach two sessions at once, and a batch cannot double-book itself. Serialised per trainer with an
   * advisory lock so two concurrent requests cannot both pass the check.
   */
  async function assertNoOverlap(tx: Tx, batch: BatchRow, startsAt: string, endsAt: string, excludeId: string | null): Promise<void> {
    if (batch.trainerId) await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [`trainer:${batch.trainerId}`])
    const r = await tx.query(
      `SELECT s.id, b.code, s.title FROM class_sessions s JOIN batches b ON b.id = s.batch_id
       WHERE b.deleted_at IS NULL AND s.status <> 'cancelled' AND s.starts_at < $2::timestamptz AND s.ends_at > $1::timestamptz
         AND (s.batch_id = $3::uuid OR ($4::uuid IS NOT NULL AND b.trainer_id = $4::uuid)) AND ($5::uuid IS NULL OR s.id <> $5::uuid) LIMIT 1`,
      [startsAt, endsAt, batch.id, batch.trainerId, excludeId])
    const clash = r.rows[0] as Row | undefined
    if (clash) throw AppError.conflict('This time overlaps another session for the same batch or trainer', { sessionId: clash.id, batchCode: clash.code, title: clash.title })
  }
  const assertBatchOpen = (b: BatchRow): void => { if (b.status !== 'planned' && b.status !== 'ongoing') throw AppError.conflict(`A ${b.status} batch cannot get or change sessions`) }

  async function create(actor: AuthContext, input: SessionCreate, info: ReqInfo) {
    const id = await withTransaction(db, async (tx) => {
      const batch = await loadBatch(tx, actor, input.batchId, 'teach', true)
      assertBatchOpen(batch)
      await assertInstitutionActive(tx, batch.institutionId)
      validateSessionTimes(input.startsAt, input.endsAt)
      const mode = input.mode ?? 'offline'
      validateSessionMode(mode, input.joinUrl)
      await assertNoOverlap(tx, batch, input.startsAt, input.endsAt, null)
      const newId = ((await tx.query(
        `INSERT INTO class_sessions (batch_id, title, starts_at, ends_at, mode, join_url, location, created_by) VALUES ($1,$2,$3::timestamptz,$4::timestamptz,$5,$6,$7,$8) RETURNING id`,
        [batch.id, input.title.trim(), input.startsAt, input.endsAt, mode, input.joinUrl ?? null, input.location ?? null, actor.userId])).rows[0] as Row).id as string
      await writeAudit(tx, { ...auditBase(actor, info), action: 'session.create', entityType: 'class_session', entityId: newId, institutionId: batch.institutionId, changes: { batchId: batch.id, startsAt: input.startsAt, endsAt: input.endsAt } })
      return newId
    })
    return get(actor, id)
  }

  async function update(actor: AuthContext, id: string, patch: SessionPatch, expectedVersion: number, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const cur = await loadSession(actor, id, tx)
      const batch = await loadBatch(tx, actor, cur.batch_id as string, 'teach', true)
      if (isSessionClosed(cur.status as SessionStatus)) throw AppError.conflict(`A ${String(cur.status)} session cannot be edited`)
      assertBatchOpen(batch)
      const fresh = (await tx.query(`SELECT version, starts_at, ends_at, mode, join_url FROM class_sessions WHERE id = $1 FOR UPDATE`, [id])).rows[0] as Row
      if ((fresh.version as number) !== expectedVersion) throw AppError.preconditionFailed()
      const startsAt = patch.startsAt ?? (fresh.starts_at as Date).toISOString()
      const endsAt = patch.endsAt ?? (fresh.ends_at as Date).toISOString()
      const mode = patch.mode ?? (fresh.mode as SessionMode)
      validateSessionTimes(startsAt, endsAt)
      validateSessionMode(mode, patch.joinUrl !== undefined ? patch.joinUrl : (fresh.join_url as string | null))
      if (patch.startsAt !== undefined || patch.endsAt !== undefined) await assertNoOverlap(tx, batch, startsAt, endsAt, id)
      const q = buildUpdate({ table: 'class_sessions', id, expectedVersion, softDeleted: false, returning: 'id',
        sets: { title: patch.title?.trim(), starts_at: patch.startsAt, ends_at: patch.endsAt, mode: patch.mode, join_url: patch.joinUrl, location: patch.location } })
      if (!(await tx.query(q.sql, q.params)).rows[0]) throw AppError.preconditionFailed()
      await writeAudit(tx, { ...auditBase(actor, info), action: 'session.update', entityType: 'class_session', entityId: id, institutionId: batch.institutionId, changes: { fields: Object.keys(patch).filter((k) => (patch as Row)[k] !== undefined) } })
    })
    return get(actor, id)
  }

  async function transition(actor: AuthContext, id: string, target: SessionStatus, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const cur = await loadSession(actor, id, tx)
      const batch = await loadBatch(tx, actor, cur.batch_id as string, 'teach', true)
      const locked = (await tx.query(`SELECT status FROM class_sessions WHERE id = $1 FOR UPDATE`, [id])).rows[0] as Row
      const to = planSessionTransition(locked.status as SessionStatus, target)
      await tx.query(`UPDATE class_sessions SET status = $2 WHERE id = $1`, [id, to])
      await writeAudit(tx, { ...auditBase(actor, info), action: `session.${to}`, entityType: 'class_session', entityId: id, institutionId: batch.institutionId, changes: { from: locked.status, to } })
    })
    return get(actor, id)
  }

  /** Sessions with attendance recorded are history: cancel them instead of deleting. */
  async function remove(actor: AuthContext, id: string, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const cur = await loadSession(actor, id, tx)
      const batch = await loadBatch(tx, actor, cur.batch_id as string, 'teach', true)
      const n = ((await tx.query(`SELECT count(*)::int AS n FROM attendance WHERE session_id = $1`, [id])).rows[0] as Row).n as number
      if (n > 0) throw AppError.conflict('Attendance has been recorded for this session; cancel it instead', { records: n })
      await tx.query(`DELETE FROM class_sessions WHERE id = $1`, [id])
      await writeAudit(tx, { ...auditBase(actor, info), action: 'session.delete', entityType: 'class_session', entityId: id, institutionId: batch.institutionId })
    })
  }

  return { list, timetable, get, create, update, transition, remove }
}
export type SessionsService = ReturnType<typeof createSessionsService>
