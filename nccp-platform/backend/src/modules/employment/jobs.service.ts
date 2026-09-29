import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, likePattern, buildUpdate, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertEmployerAccess, isSuperAdmin, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import {
  planJobTransition, isJobEditable, validateJobForPublish, validateSalary,
  type JobAction, type JobStatus,
} from './employment.rules.js'
import { toJobRecord, shapeJob, type JobRecord } from './employment.dto.js'

type Row = Record<string, unknown>

export interface JobFields {
  employerId: string; title: string; employmentType?: string; openings?: number; location?: string | null
  workMode?: string | null; experience?: string | null; salaryText?: string | null; salaryMin?: number | null
  salaryMax?: number | null; description?: string | null; requiredSkills?: string | null; preferredSkills?: string | null
  qualification?: string | null; benefits?: string | null; deadline?: string | null
}

export interface JobFilter {
  employerId?: string; status?: JobStatus; employmentType?: string; workMode?: string; location?: string; q?: string
}

const COLS = `j.id, j.employer_id, j.title, j.employment_type, j.openings, j.location, j.work_mode, j.experience,
  j.salary_text, j.salary_min::float8 AS salary_min, j.salary_max::float8 AS salary_max,
  j.description, j.required_skills, j.preferred_skills, j.qualification, j.benefits,
  j.deadline::text AS deadline, j.status, j.published_at, j.closed_at, j.created_at, j.updated_at, j.version`

const FIELD_TO_COLUMN: Record<string, string> = {
  title: 'title', employmentType: 'employment_type', openings: 'openings', location: 'location',
  workMode: 'work_mode', experience: 'experience', salaryText: 'salary_text', salaryMin: 'salary_min',
  salaryMax: 'salary_max', description: 'description', requiredSkills: 'required_skills',
  preferredSkills: 'preferred_skills', qualification: 'qualification', benefits: 'benefits', deadline: 'deadline',
}

const audit = (actor: AuthContext | null, info: ReqInfo, action: string, id: string, employerId?: string, changes?: Record<string, unknown>) =>
  ({ action, actorUserId: actor?.userId ?? null, actorRole: actor?.role ?? null, entityType: 'job', entityId: id, employerId: employerId ?? null, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes })

export function createJobsService(db: Db) {

  async function loadScoped(actor: AuthContext, id: string, client: Db | Tx = db, lock = false): Promise<Row & { employer_status: string }> {
    const r = await client.query(
      `SELECT ${COLS}, e.verification_status AS employer_status
         FROM jobs j
         JOIN employers e ON e.id = j.employer_id AND e.deleted_at IS NULL
        WHERE j.id = $1 AND j.deleted_at IS NULL${lock ? ' FOR UPDATE OF j' : ''}`,
      [id],
    )
    const row = r.rows[0] as (Row & { employer_status: string }) | undefined
    if (!row) throw AppError.notFound('Job')

    if (!isSuperAdmin(actor)) {
      if (actor.role === 'employer') {
        assertEmployerAccess(actor, row.employer_id as string, 'Job')
      } else {
        // Trainees / trainers / others only see active jobs from verified employers
        const today = new Date().toISOString().slice(0, 10)
        if (row.status !== 'active' || row.employer_status !== 'verified' || (row.deadline && (row.deadline as string) < today)) {
          throw AppError.notFound('Job')
        }
      }
    }

    return row
  }

  function visibility(actor: AuthContext, params: unknown[]): string | null {
    if (isSuperAdmin(actor)) return null
    if (actor.role === 'employer') {
      params.push(actor.employerIds)
      return `j.employer_id = ANY($${params.length}::uuid[])`
    }
    // Trainees and others see only live jobs from verified employers whose deadline has not passed
    const today = new Date().toISOString().slice(0, 10)
    params.push(today)
    return `j.status = 'active' AND e.verification_status = 'verified' AND (j.deadline IS NULL OR j.deadline >= $${params.length})`
  }

  async function list(actor: AuthContext, f: JobFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['j.deleted_at IS NULL', 'e.deleted_at IS NULL']
    const vis = visibility(actor, params)
    if (vis) where.push(vis)

    if (f.employerId) { params.push(f.employerId); where.push(`j.employer_id = $${params.length}`) }
    if (f.status && (isSuperAdmin(actor) || actor.role === 'employer')) {
      params.push(f.status); where.push(`j.status = $${params.length}`)
    }
    if (f.employmentType) { params.push(f.employmentType); where.push(`j.employment_type = $${params.length}`) }
    if (f.workMode) { params.push(f.workMode); where.push(`j.work_mode = $${params.length}`) }
    if (f.location) { params.push(likePattern(f.location)); where.push(`j.location ILIKE $${params.length}`) }
    if (f.q) {
      params.push(likePattern(f.q))
      where.push(`(j.title ILIKE $${params.length} OR j.description ILIKE $${params.length} OR j.required_skills ILIKE $${params.length})`)
    }

    return keysetList(db, {
      select: COLS,
      from: 'jobs j JOIN employers e ON e.id = j.employer_id',
      where,
      params,
      sort,
      idExpr: 'j.id',
      page,
      map: (r: Row) => shapeJob(toJobRecord(r), actor.role),
    })
  }

  async function get(actor: AuthContext, id: string) {
    const row = await loadScoped(actor, id)
    return shapeJob(toJobRecord(row), actor.role)
  }

  async function create(actor: AuthContext, input: JobFields, info: ReqInfo) {
    if (!isSuperAdmin(actor)) {
      if (actor.role !== 'employer') throw AppError.forbidden('Only employers can create job postings')
      assertEmployerAccess(actor, input.employerId, 'Employer')
    }

    validateSalary(input.salaryMin, input.salaryMax)

    const id = await withTransaction(db, async (tx) => {
      // Check employer exists
      const emp = await tx.query(`SELECT verification_status FROM employers WHERE id = $1 AND deleted_at IS NULL`, [input.employerId])
      if (!emp.rows.length) throw AppError.notFound('Employer')

      const r = await tx.query(
        `INSERT INTO jobs (
          employer_id, title, employment_type, openings, location, work_mode, experience,
          salary_text, salary_min, salary_max, description, required_skills, preferred_skills,
          qualification, benefits, deadline, status, created_by
        ) VALUES (
          $1, $2, COALESCE($3, 'Full time'), COALESCE($4, 1), $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16, 'draft', $17
        ) RETURNING id`,
        [
          input.employerId, input.title.trim(), input.employmentType ?? null, input.openings ?? 1,
          input.location ?? null, input.workMode ?? null, input.experience ?? null,
          input.salaryText ?? null, input.salaryMin ?? null, input.salaryMax ?? null,
          input.description ?? null, input.requiredSkills ?? null, input.preferredSkills ?? null,
          input.qualification ?? null, input.benefits ?? null, input.deadline ?? null,
          actor.userId,
        ],
      )
      const newId = (r.rows[0] as Row).id as string
      await writeAudit(tx, audit(actor, info, 'job.create', newId, input.employerId, { title: input.title }))
      return newId
    })

    return get(actor, id)
  }

  async function update(actor: AuthContext, id: string, input: Partial<JobFields>, expectedVersion: number, info: ReqInfo) {
    const existing = await loadScoped(actor, id)
    if (!isJobEditable(existing.status as JobStatus)) {
      throw AppError.conflict('Closed jobs cannot be modified')
    }

    if (input.salaryMin !== undefined || input.salaryMax !== undefined) {
      const min = input.salaryMin !== undefined ? input.salaryMin : (existing.salary_min as number | null)
      const max = input.salaryMax !== undefined ? input.salaryMax : (existing.salary_max as number | null)
      validateSalary(min, max)
    }

    const sets: Record<string, unknown> = {}
    for (const [key, col] of Object.entries(FIELD_TO_COLUMN)) {
      if ((input as Record<string, unknown>)[key] !== undefined) {
        sets[col] = (input as Record<string, unknown>)[key]
      }
    }
    if (!Object.keys(sets).length) throw AppError.validation([{ path: 'body', message: 'Nothing to update' }])

    const { sql, params } = buildUpdate({ table: 'jobs', id, expectedVersion, sets })
    await withTransaction(db, async (tx) => {
      const result = await tx.query(sql, params)
      if (!result.rowCount) throw AppError.preconditionFailed()
      await writeAudit(tx, audit(actor, info, 'job.update', id, existing.employer_id as string, sets))
    })

    return get(actor, id)
  }

  async function transition(actor: AuthContext, id: string, action: JobAction, expectedVersion: number, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const row = await loadScoped(actor, id, tx, true)
      const current = row.status as JobStatus
      const nextStatus = planJobTransition(current, action, row.employer_status)

      if (action === 'publish') {
        const today = new Date().toISOString().slice(0, 10)
        validateJobForPublish({
          title: row.title as string,
          description: (row.description as string | null) ?? null,
          openings: row.openings as number,
          location: (row.location as string | null) ?? null,
          workMode: (row.work_mode as string | null) ?? null,
          deadline: (row.deadline as string | null) ?? null,
        }, today)
      }

      const sets: Record<string, unknown> = { status: nextStatus }
      if (action === 'publish') sets.published_at = new Date()
      if (action === 'close') sets.closed_at = new Date()

      const { sql, params } = buildUpdate({ table: 'jobs', id, expectedVersion, sets })
      const r = await tx.query(sql, params)
      if (!r.rowCount) throw AppError.preconditionFailed()

      await writeAudit(tx, audit(actor, info, `job.${action}`, id, row.employer_id as string, { from: current, to: nextStatus }))
      return get(actor, id)
    })
  }

  return { list, get, create, update, transition }
}

export type JobsService = ReturnType<typeof createJobsService>
