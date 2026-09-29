import type { Db, Tx } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { capacityStatusesSql } from '../training/constants.js'

export type Row = Record<string, unknown>

/** Actor + request fields common to every audit row. */
export const auditBase = (actor: AuthContext, info: ReqInfo) => ({ actorUserId: actor.userId, actorRole: actor.role, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent })

export interface BatchRow {
  id: string; code: string; institutionId: string; trainerId: string | null; trainerUserId: string | null
  programmeId: string; status: string; startDate: string; endDate: string; capacity: number
}
/** 'read' = anyone who may see the batch; 'teach' = admins plus the batch's own trainer; 'manage' = admins only. */
export type BatchNeed = 'read' | 'teach' | 'manage'

const BATCH_SQL = `SELECT b.id, b.code, b.institution_id, b.trainer_id, tr.user_id AS trainer_user_id, b.programme_id, b.status,
    b.start_date::text AS start_date, b.end_date::text AS end_date, b.capacity
  FROM batches b LEFT JOIN trainers tr ON tr.id = b.trainer_id WHERE b.id = $1 AND b.deleted_at IS NULL`

const toBatchRow = (r: Row): BatchRow => ({
  id: r.id as string, code: r.code as string, institutionId: r.institution_id as string, trainerId: (r.trainer_id as string | null) ?? null,
  trainerUserId: (r.trainer_user_id as string | null) ?? null, programmeId: r.programme_id as string, status: r.status as string,
  startDate: r.start_date as string, endDate: r.end_date as string, capacity: r.capacity as number,
})

/** The trainee profile id of a user (null if they have none or it is soft-deleted). */
export async function traineeIdOfUser(db: Db | Tx, userId: string): Promise<string | null> {
  const r = await db.query(`SELECT id FROM trainees WHERE user_id = $1 AND deleted_at IS NULL`, [userId])
  return ((r.rows[0] as Row | undefined)?.id as string | undefined) ?? null
}

/**
 * Load a batch the caller may see, or throw 404 (never 403 for out-of-scope records). Then check the caller's role can do
 * what `need` asks (403 for a visible record the role may not change). `lock` takes the batch row lock that enrolment,
 * capacity edits and session scheduling all serialise on. Trainees see a batch only while they hold a seat in it.
 */
export async function loadBatch(db: Db | Tx, actor: AuthContext, batchId: string, need: BatchNeed = 'read', lock = false): Promise<BatchRow> {
  const r = await db.query(`${BATCH_SQL}${lock ? ' FOR UPDATE OF b' : ''}`, [batchId])
  const row = r.rows[0] as Row | undefined
  if (!row) throw AppError.notFound('Batch')
  const b = toBatchRow(row)
  let visible = false
  if (actor.role === 'super_admin') visible = true
  else if (actor.role === 'institution_admin') visible = actor.institutionIds.includes(b.institutionId)
  else if (actor.role === 'trainer') visible = b.trainerUserId === actor.userId
  else if (actor.role === 'trainee') {
    const seat = await db.query(
      `SELECT 1 FROM batch_enrolments e JOIN trainees t ON t.id = e.trainee_id
       WHERE e.batch_id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL AND e.status IN (${capacityStatusesSql()})`, [batchId, actor.userId])
    visible = seat.rows.length > 0
  }
  if (!visible) throw AppError.notFound('Batch')
  const isAdmin = actor.role === 'super_admin' || actor.role === 'institution_admin'
  if (need === 'manage' && !isAdmin) throw AppError.forbidden()
  if (need === 'teach' && !isAdmin && actor.role !== 'trainer') throw AppError.forbidden()
  return b
}

export const seatsTaken = async (db: Db | Tx, batchId: string): Promise<number> =>
  ((await db.query(`SELECT count(*)::int AS n FROM batch_enrolments WHERE batch_id = $1 AND status IN (${capacityStatusesSql()})`, [batchId])).rows[0] as Row).n as number

/** Batch ids the caller may see in lists, as a SQL predicate on alias `b` (trainer alias `tr` must be joined for trainers). */
export function batchVisibilitySql(actor: AuthContext, params: unknown[], opts: { trainerAlias?: string } = {}): string {
  const tr = opts.trainerAlias ?? 'tr'
  if (actor.role === 'super_admin') return 'TRUE'
  if (actor.role === 'institution_admin') { params.push(actor.institutionIds); return `b.institution_id = ANY($${params.length}::uuid[])` }
  if (actor.role === 'trainer') { params.push(actor.userId); return `${tr}.user_id = $${params.length}` }
  if (actor.role === 'trainee') {
    params.push(actor.userId)
    return `EXISTS (SELECT 1 FROM batch_enrolments e9 JOIN trainees t9 ON t9.id = e9.trainee_id WHERE e9.batch_id = b.id AND t9.user_id = $${params.length} AND t9.deleted_at IS NULL AND e9.status IN (${capacityStatusesSql()}))`
  }
  return 'FALSE'
}

/** Recalculate progress (completed lessons / lessons in published courses of the programme) and move enrolled -> in_progress. */
export async function recomputeProgress(tx: Tx, programmeId: string, traineeId: string | null = null): Promise<void> {
  await tx.query(
    `UPDATE batch_enrolments e SET progress_percent = x.pct,
            status = CASE WHEN e.status = 'enrolled' AND x.done > 0 THEN 'in_progress' ELSE e.status END
     FROM (
       SELECT e2.id, d.done, CASE WHEN t.n = 0 THEN 0::numeric ELSE round(d.done * 100.0 / t.n, 2) END AS pct
       FROM batch_enrolments e2
       JOIN batches b ON b.id = e2.batch_id AND b.programme_id = $1
       CROSS JOIN LATERAL (
         SELECT count(*)::int AS n FROM lessons l JOIN modules m ON m.id = l.module_id AND m.deleted_at IS NULL
           JOIN courses c ON c.id = m.course_id AND c.deleted_at IS NULL AND c.status = 'published'
          WHERE c.programme_id = $1 AND l.deleted_at IS NULL) t
       CROSS JOIN LATERAL (
         SELECT count(*)::int AS done FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id AND l.deleted_at IS NULL
           JOIN modules m ON m.id = l.module_id AND m.deleted_at IS NULL
           JOIN courses c ON c.id = m.course_id AND c.deleted_at IS NULL AND c.status = 'published'
          WHERE c.programme_id = $1 AND lp.trainee_id = e2.trainee_id AND lp.status = 'completed') d
       WHERE e2.status IN ('enrolled','in_progress') AND ($2::uuid IS NULL OR e2.trainee_id = $2::uuid)
     ) x
     WHERE e.id = x.id AND (e.progress_percent <> x.pct OR (e.status = 'enrolled' AND x.done > 0))`,
    [programmeId, traineeId],
  )
}
