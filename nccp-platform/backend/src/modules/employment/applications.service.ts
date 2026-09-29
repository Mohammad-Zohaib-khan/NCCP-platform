import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, buildUpdate, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertEmployerAccess, isSuperAdmin, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import {
  planApplicationTransition, isJobOpenForApplications, computeMatchScore,
  type ApplicationAction, type ApplicationStatus,
} from './employment.rules.js'
import {
  toApplicationRecord, shapeApplication, toStatusHistoryEntry,
  type ApplicationRecord, type StatusHistoryEntry,
} from './employment.dto.js'

type Row = Record<string, unknown>

export interface ApplicationFilter {
  jobId?: string; traineeId?: string; status?: ApplicationStatus
}

export interface ApplyInput {
  jobId: string; coverNote?: string | null; resumeFileId?: string | null
}

const COLS = `a.id, a.job_id, a.trainee_id, a.status, a.match_score::float8 AS match_score,
  a.cover_note, a.employer_notes, a.applied_at, a.updated_at, a.version`

const audit = (actor: AuthContext | null, info: ReqInfo, action: string, id: string, employerId?: string, changes?: Record<string, unknown>) =>
  ({ action, actorUserId: actor?.userId ?? null, actorRole: actor?.role ?? null, entityType: 'application', entityId: id, employerId: employerId ?? null, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes })

export function createApplicationsService(db: Db) {

  async function resolveTraineeId(actor: AuthContext): Promise<string> {
    const r = await db.query(`SELECT id FROM trainees WHERE user_id = $1 AND deleted_at IS NULL`, [actor.userId])
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.forbidden('User does not have an active trainee profile')
    return row.id as string
  }

  async function loadScoped(actor: AuthContext, id: string, client: Db | Tx = db, lock = false): Promise<Row & { employer_id: string; job_title: string; trainee_user_id: string }> {
    const r = await client.query(
      `SELECT ${COLS}, j.employer_id, j.title AS job_title, t.user_id AS trainee_user_id
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         JOIN trainees t ON t.id = a.trainee_id
        WHERE a.id = $1${lock ? ' FOR UPDATE OF a' : ''}`,
      [id],
    )
    const row = r.rows[0] as (Row & { employer_id: string; job_title: string; trainee_user_id: string }) | undefined
    if (!row) throw AppError.notFound('Application')

    if (!isSuperAdmin(actor)) {
      if (actor.role === 'employer') {
        assertEmployerAccess(actor, row.employer_id, 'Application')
      } else if (actor.role === 'trainee') {
        if (row.trainee_user_id !== actor.userId) throw AppError.notFound('Application')
      } else if (actor.role === 'institution_admin') {
        // Institution admins can view applications of trainees enrolled in their institution
        const inScope = await client.query(
          `SELECT 1 FROM batch_enrolments be JOIN batches b ON b.id = be.batch_id
            WHERE be.trainee_id = $1 AND b.institution_id = ANY($2::uuid[])`,
          [row.trainee_id, actor.institutionIds],
        )
        if (!inScope.rows.length) throw AppError.notFound('Application')
      } else {
        throw AppError.forbidden()
      }
    }

    return row
  }

  async function apply(actor: AuthContext, input: ApplyInput, info: ReqInfo) {
    if (actor.role !== 'trainee') throw AppError.forbidden('Only trainees can apply for jobs')
    const traineeId = await resolveTraineeId(actor)

    return withTransaction(db, async (tx) => {
      // 1. Check job availability
      const jRes = await tx.query(
        `SELECT j.id, j.employer_id, j.title, j.status, j.deadline::text AS deadline,
                j.required_skills, j.preferred_skills, j.location AS job_location, j.work_mode,
                e.verification_status AS employer_status
           FROM jobs j
           JOIN employers e ON e.id = j.employer_id AND e.deleted_at IS NULL
          WHERE j.id = $1 AND j.deleted_at IS NULL FOR SHARE OF j`,
        [input.jobId],
      )
      const job = jRes.rows[0] as Row | undefined
      if (!job) throw AppError.notFound('Job')

      const today = new Date().toISOString().slice(0, 10)
      if (!isJobOpenForApplications({
        status: job.status as string,
        deadline: (job.deadline as string | null) ?? null,
        employerStatus: job.employer_status as string,
      }, today)) {
        throw AppError.conflict('This job is not currently accepting applications')
      }

      // 2. Check if already applied
      const existing = await tx.query(`SELECT id FROM applications WHERE job_id = $1 AND trainee_id = $2`, [input.jobId, traineeId])
      if (existing.rows.length) throw AppError.conflict('You have already applied for this job')

      // 3. Compute match score
      const tRes = await tx.query(
        `SELECT t.skills, t.location, t.district, t.state,
                EXISTS(SELECT 1 FROM certificates c WHERE c.trainee_id = t.id AND c.status = 'issued') AS has_cert
           FROM trainees t WHERE t.id = $1`,
        [traineeId],
      )
      const traineeData = tRes.rows[0] as Row
      const match = computeMatchScore({
        requiredSkills: (job.required_skills as string | null) ?? null,
        preferredSkills: (job.preferred_skills as string | null) ?? null,
        jobLocation: (job.job_location as string | null) ?? null,
        workMode: (job.work_mode as string | null) ?? null,
        trainee: {
          skills: (traineeData.skills as string[]) ?? [],
          location: (traineeData.location as string | null) ?? null,
          district: (traineeData.district as string | null) ?? null,
          state: (traineeData.state as string | null) ?? null,
        },
        hasLiveCertificate: Boolean(traineeData.has_cert),
      })

      // 4. Insert application
      const insRes = await tx.query(
        `INSERT INTO applications (job_id, trainee_id, status, match_score, cover_note, resume_file_id)
         VALUES ($1, $2, 'review', $3, $4, $5)
         RETURNING id, applied_at, version`,
        [input.jobId, traineeId, match.score, input.coverNote ?? null, input.resumeFileId ?? null],
      )
      const appRow = insRes.rows[0] as Row
      const appId = appRow.id as string

      // 5. Append status history
      await tx.query(
        `INSERT INTO application_status_history (application_id, from_status, to_status, changed_by, note)
         VALUES ($1, NULL, 'review', $2, 'Application submitted')`,
        [appId, actor.userId],
      )

      await writeAudit(tx, audit(actor, info, 'application.apply', appId, job.employer_id as string, { jobId: input.jobId, matchScore: match.score }))

      return {
        id: appId,
        jobId: input.jobId,
        traineeId,
        status: 'review' as ApplicationStatus,
        matchScore: match.score,
        matchBreakdown: match.breakdown,
        coverNote: input.coverNote ?? null,
        appliedAt: appRow.applied_at as Date,
        version: appRow.version as number,
      }
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
    if (actor.role === 'institution_admin') {
      params.push(actor.institutionIds)
      return `EXISTS (SELECT 1 FROM batch_enrolments be JOIN batches b ON b.id = be.batch_id WHERE be.trainee_id = a.trainee_id AND b.institution_id = ANY($${params.length}::uuid[]))`
    }
    return 'FALSE'
  }

  async function list(actor: AuthContext, f: ApplicationFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where: string[] = []
    const vis = visibility(actor, params)
    if (vis) where.push(vis)

    if (f.jobId) { params.push(f.jobId); where.push(`a.job_id = $${params.length}`) }
    if (f.traineeId) { params.push(f.traineeId); where.push(`a.trainee_id = $${params.length}`) }
    if (f.status) { params.push(f.status); where.push(`a.status = $${params.length}`) }

    return keysetList(db, {
      select: COLS,
      from: 'applications a JOIN jobs j ON j.id = a.job_id JOIN trainees t ON t.id = a.trainee_id',
      where,
      params,
      sort,
      idExpr: 'a.id',
      page,
      map: (r: Row) => shapeApplication(toApplicationRecord(r), actor.role),
    })
  }

  async function get(actor: AuthContext, id: string) {
    const row = await loadScoped(actor, id)
    const historyRes = await db.query(
      `SELECT id, from_status, to_status, changed_by, note, changed_at
         FROM application_status_history
        WHERE application_id = $1
        ORDER BY changed_at ASC`,
      [id],
    )
    const history = (historyRes.rows as Row[]).map(toStatusHistoryEntry)

    return {
      ...shapeApplication(toApplicationRecord(row), actor.role),
      history,
    }
  }

  async function transition(actor: AuthContext, id: string, action: ApplicationAction, note: string | null | undefined, expectedVersion: number, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const row = await loadScoped(actor, id, tx, true)
      const current = row.status as ApplicationStatus
      const side = actor.role === 'trainee' ? 'trainee' : 'employer'

      const plan = planApplicationTransition(current, action, side, note)

      const sets: Record<string, unknown> = {
        status: plan.to,
      }
      if (plan.to === 'rejected' || plan.to === 'placed') {
        sets.decided_by = actor.userId
        sets.decided_at = new Date()
      }

      const { sql, params } = buildUpdate({ table: 'applications', id, expectedVersion, sets, softDeleted: false })
      const r = await tx.query(sql, params)
      if (!r.rowCount) throw AppError.preconditionFailed()

      // Append status history
      await tx.query(
        `INSERT INTO application_status_history (application_id, from_status, to_status, changed_by, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, current, plan.to, actor.userId, plan.note],
      )

      await writeAudit(tx, audit(actor, info, `application.${action}`, id, row.employer_id, { from: current, to: plan.to, note: plan.note }))

      return get(actor, id)
    })
  }

  async function updateNotes(actor: AuthContext, id: string, employerNotes: string, expectedVersion: number, info: ReqInfo) {
    if (actor.role !== 'employer' && !isSuperAdmin(actor)) throw AppError.forbidden()
    const row = await loadScoped(actor, id)

    const { sql, params } = buildUpdate({
      table: 'applications',
      id,
      expectedVersion,
      sets: { employer_notes: employerNotes },
      softDeleted: false,
    })

    await withTransaction(db, async (tx) => {
      const r = await tx.query(sql, params)
      if (!r.rowCount) throw AppError.preconditionFailed()
      await writeAudit(tx, audit(actor, info, 'application.update_notes', id, row.employer_id, { notesUpdated: true }))
    })

    return get(actor, id)
  }

  return { apply, list, get, transition, updateNotes }
}

export type ApplicationsService = ReturnType<typeof createApplicationsService>
