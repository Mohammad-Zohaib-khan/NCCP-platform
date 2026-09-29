import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, buildUpdate, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertEmployerAccess, isSuperAdmin, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import {
  validateInterview, planInterviewTransition,
  type InterviewMode, type InterviewStatus,
} from './employment.rules.js'
import { toInterviewRecord, shapeInterview, type InterviewRecord } from './employment.dto.js'

type Row = Record<string, unknown>

export interface InterviewScheduleInput {
  applicationId: string; scheduledAt: Date | string; mode: InterviewMode
  locationOrLink?: string | null; notes?: string | null
}

export interface InterviewFilter {
  applicationId?: string; status?: InterviewStatus
}

const COLS = `i.id, i.application_id, i.scheduled_at, i.mode, i.location_or_link, i.notes,
  i.status, i.outcome_notes, i.created_at, i.updated_at, i.version`

const audit = (actor: AuthContext | null, info: ReqInfo, action: string, id: string, employerId?: string, changes?: Record<string, unknown>) =>
  ({ action, actorUserId: actor?.userId ?? null, actorRole: actor?.role ?? null, entityType: 'interview', entityId: id, employerId: employerId ?? null, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes })

export function createInterviewsService(db: Db) {

  async function loadScoped(actor: AuthContext, id: string, client: Db | Tx = db, lock = false): Promise<Row & { employer_id: string; trainee_user_id: string }> {
    const r = await client.query(
      `SELECT ${COLS}, j.employer_id, t.user_id AS trainee_user_id
         FROM interviews i
         JOIN applications a ON a.id = i.application_id
         JOIN jobs j ON j.id = a.job_id
         JOIN trainees t ON t.id = a.trainee_id
        WHERE i.id = $1${lock ? ' FOR UPDATE OF i' : ''}`,
      [id],
    )
    const row = r.rows[0] as (Row & { employer_id: string; trainee_user_id: string }) | undefined
    if (!row) throw AppError.notFound('Interview')

    if (!isSuperAdmin(actor)) {
      if (actor.role === 'employer') {
        assertEmployerAccess(actor, row.employer_id, 'Interview')
      } else if (actor.role === 'trainee') {
        if (row.trainee_user_id !== actor.userId) throw AppError.notFound('Interview')
      } else {
        throw AppError.forbidden()
      }
    }

    return row
  }

  async function schedule(actor: AuthContext, input: InterviewScheduleInput, info: ReqInfo) {
    if (actor.role !== 'employer' && !isSuperAdmin(actor)) {
      throw AppError.forbidden('Only employers can schedule interviews')
    }

    const scheduledDate = new Date(input.scheduledAt)
    validateInterview({
      scheduledAt: scheduledDate,
      mode: input.mode,
      locationOrLink: input.locationOrLink,
    }, new Date())

    return withTransaction(db, async (tx) => {
      // Load application
      const appRes = await tx.query(
        `SELECT a.id, a.status, j.employer_id
           FROM applications a
           JOIN jobs j ON j.id = a.job_id
          WHERE a.id = $1 FOR UPDATE OF a`,
        [input.applicationId],
      )
      const app = appRes.rows[0] as Row | undefined
      if (!app) throw AppError.notFound('Application')

      if (!isSuperAdmin(actor)) {
        assertEmployerAccess(actor, app.employer_id as string, 'Application')
      }

      if (app.status !== 'shortlisted' && app.status !== 'interview') {
        throw AppError.conflict(`Cannot schedule an interview for an application in ${app.status} status`)
      }

      // If application was 'shortlisted', advance to 'interview'
      if (app.status === 'shortlisted') {
        await tx.query(
          `UPDATE applications SET status = 'interview', updated_at = now() WHERE id = $1`,
          [input.applicationId],
        )
        await tx.query(
          `INSERT INTO application_status_history (application_id, from_status, to_status, changed_by, note)
           VALUES ($1, 'shortlisted', 'interview', $2, 'Interview scheduled')`,
          [input.applicationId, actor.userId],
        )
      }

      const insRes = await tx.query(
        `INSERT INTO interviews (application_id, scheduled_at, mode, location_or_link, notes, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'scheduled', $6)
         RETURNING id`,
        [input.applicationId, scheduledDate, input.mode, input.locationOrLink ?? null, input.notes ?? null, actor.userId],
      )
      const newId = (insRes.rows[0] as Row).id as string

      await writeAudit(tx, audit(actor, info, 'interview.schedule', newId, app.employer_id as string, { applicationId: input.applicationId, mode: input.mode, scheduledAt: scheduledDate }))

      return get(actor, newId)
    })
  }

  function visibility(actor: AuthContext, params: unknown[]): string | null {
    if (isSuperAdmin(actor)) return null
    if (actor.role === 'employer') {
      params.push(actor.employerIds)
      return `j.employer_id = ANY($${params.length}::uuid[])`
    }
    if (actor.role === 'trainee') {
      params.push(actor.userId)
      return `t.user_id = $${params.length}`
    }
    return 'FALSE'
  }

  async function list(actor: AuthContext, f: InterviewFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where: string[] = []
    const vis = visibility(actor, params)
    if (vis) where.push(vis)

    if (f.applicationId) { params.push(f.applicationId); where.push(`i.application_id = $${params.length}`) }
    if (f.status) { params.push(f.status); where.push(`i.status = $${params.length}`) }

    return keysetList(db, {
      select: COLS,
      from: 'interviews i JOIN applications a ON a.id = i.application_id JOIN jobs j ON j.id = a.job_id JOIN trainees t ON t.id = a.trainee_id',
      where,
      params,
      sort,
      idExpr: 'i.id',
      page,
      map: (r: Row) => shapeInterview(toInterviewRecord(r), actor.role),
    })
  }

  async function get(actor: AuthContext, id: string) {
    const row = await loadScoped(actor, id)
    return shapeInterview(toInterviewRecord(row), actor.role)
  }

  async function updateStatus(actor: AuthContext, id: string, targetStatus: InterviewStatus, outcomeNotes: string | null | undefined, expectedVersion: number, info: ReqInfo) {
    if (actor.role !== 'employer' && !isSuperAdmin(actor)) {
      throw AppError.forbidden('Only employers can update interview status')
    }

    return withTransaction(db, async (tx) => {
      const row = await loadScoped(actor, id, tx, true)
      const current = row.status as InterviewStatus
      const nextStatus = planInterviewTransition(current, targetStatus)

      const sets: Record<string, unknown> = {
        status: nextStatus,
      }
      if (outcomeNotes !== undefined) sets.outcome_notes = outcomeNotes

      const { sql, params } = buildUpdate({ table: 'interviews', id, expectedVersion, sets, softDeleted: false })
      const r = await tx.query(sql, params)
      if (!r.rowCount) throw AppError.preconditionFailed()

      await writeAudit(tx, audit(actor, info, 'interview.update_status', id, row.employer_id, { from: current, to: nextStatus, outcomeNotes }))

      return get(actor, id)
    })
  }

  return { schedule, list, get, updateStatus }
}

export type InterviewsService = ReturnType<typeof createInterviewsService>
