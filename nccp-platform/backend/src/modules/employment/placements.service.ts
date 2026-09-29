import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, buildUpdate, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertEmployerAccess, isSuperAdmin, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import {
  validatePlacement, assertOpeningAvailable, planPlacementTransition,
  type PlacementStatus,
} from './employment.rules.js'
import { toPlacementRecord, shapePlacement, type PlacementRecord } from './employment.dto.js'

type Row = Record<string, unknown>

export interface PlacementCreateInput {
  applicationId: string; joiningDate?: string | null; salaryOffered?: number | null
}

export interface PlacementFilter {
  employerId?: string; jobId?: string; traineeId?: string; status?: PlacementStatus
}

const COLS = `p.id, p.application_id, p.employer_id, p.trainee_id, p.job_id,
  p.joining_date::text AS joining_date, p.salary_offered::float8 AS salary_offered,
  p.status, p.created_at, p.updated_at, p.version`

const audit = (actor: AuthContext | null, info: ReqInfo, action: string, id: string, employerId?: string, changes?: Record<string, unknown>) =>
  ({ action, actorUserId: actor?.userId ?? null, actorRole: actor?.role ?? null, entityType: 'placement', entityId: id, employerId: employerId ?? null, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes })

export function createPlacementsService(db: Db) {

  async function loadScoped(actor: AuthContext, id: string, client: Db | Tx = db, lock = false): Promise<Row & { trainee_user_id: string }> {
    const r = await client.query(
      `SELECT ${COLS}, t.user_id AS trainee_user_id
         FROM placements p
         JOIN trainees t ON t.id = p.trainee_id
        WHERE p.id = $1${lock ? ' FOR UPDATE OF p' : ''}`,
      [id],
    )
    const row = r.rows[0] as (Row & { trainee_user_id: string }) | undefined
    if (!row) throw AppError.notFound('Placement')

    if (!isSuperAdmin(actor)) {
      if (actor.role === 'employer') {
        assertEmployerAccess(actor, row.employer_id as string, 'Placement')
      } else if (actor.role === 'trainee') {
        if (row.trainee_user_id !== actor.userId) throw AppError.notFound('Placement')
      } else if (actor.role === 'institution_admin') {
        const inScope = await client.query(
          `SELECT 1 FROM batch_enrolments be JOIN batches b ON b.id = be.batch_id
            WHERE be.trainee_id = $1 AND b.institution_id = ANY($2::uuid[])`,
          [row.trainee_id, actor.institutionIds],
        )
        if (!inScope.rows.length) throw AppError.notFound('Placement')
      } else {
        throw AppError.forbidden()
      }
    }

    return row
  }

  async function record(actor: AuthContext, input: PlacementCreateInput, info: ReqInfo) {
    if (actor.role !== 'employer' && !isSuperAdmin(actor)) {
      throw AppError.forbidden('Only employers can record placements')
    }

    validatePlacement({ joiningDate: input.joiningDate, salaryOffered: input.salaryOffered })

    return withTransaction(db, async (tx) => {
      // 1. Load application & job
      const appRes = await tx.query(
        `SELECT a.id, a.status, a.trainee_id, a.job_id, j.employer_id, j.openings
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

      if (app.status !== 'offer') {
        throw AppError.conflict(`An application must be in 'offer' status before recording a placement (currently '${app.status}')`)
      }

      // 2. Check openings
      const countRes = await tx.query(
        `SELECT count(*)::int AS occupied FROM placements WHERE job_id = $1 AND status IN ('confirmed', 'joined')`,
        [app.job_id],
      )
      const occupied = (countRes.rows[0] as Row).occupied as number
      assertOpeningAvailable(app.openings as number, occupied)

      // 3. Insert placement
      const insRes = await tx.query(
        `INSERT INTO placements (application_id, employer_id, trainee_id, job_id, joining_date, salary_offered, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7)
         RETURNING id`,
        [input.applicationId, app.employer_id, app.trainee_id, app.job_id, input.joiningDate ?? null, input.salaryOffered ?? null, actor.userId],
      )
      const placementId = (insRes.rows[0] as Row).id as string

      // 4. Update application status to 'placed'
      await tx.query(
        `UPDATE applications SET status = 'placed', decided_by = $1, decided_at = now(), updated_at = now() WHERE id = $2`,
        [actor.userId, input.applicationId],
      )
      await tx.query(
        `INSERT INTO application_status_history (application_id, from_status, to_status, changed_by, note)
         VALUES ($1, 'offer', 'placed', $2, 'Placement confirmed')`,
        [input.applicationId, actor.userId],
      )

      await writeAudit(tx, audit(actor, info, 'placement.record', placementId, app.employer_id as string, { applicationId: input.applicationId, jobId: app.job_id, traineeId: app.trainee_id }))

      return get(actor, placementId)
    })
  }

  function visibility(actor: AuthContext, params: unknown[]): string | null {
    if (isSuperAdmin(actor)) return null
    if (actor.role === 'employer') {
      params.push(actor.employerIds)
      return `p.employer_id = ANY($${params.length}::uuid[])`
    }
    if (actor.role === 'trainee') {
      params.push(actor.userId)
      return `t.user_id = $${params.length}`
    }
    if (actor.role === 'institution_admin') {
      params.push(actor.institutionIds)
      return `EXISTS (SELECT 1 FROM batch_enrolments be JOIN batches b ON b.id = be.batch_id WHERE be.trainee_id = p.trainee_id AND b.institution_id = ANY($${params.length}::uuid[]))`
    }
    return 'FALSE'
  }

  async function list(actor: AuthContext, f: PlacementFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where: string[] = []
    const vis = visibility(actor, params)
    if (vis) where.push(vis)

    if (f.employerId) { params.push(f.employerId); where.push(`p.employer_id = $${params.length}`) }
    if (f.jobId) { params.push(f.jobId); where.push(`p.job_id = $${params.length}`) }
    if (f.traineeId) { params.push(f.traineeId); where.push(`p.trainee_id = $${params.length}`) }
    if (f.status) { params.push(f.status); where.push(`p.status = $${params.length}`) }

    return keysetList(db, {
      select: COLS,
      from: 'placements p JOIN trainees t ON t.id = p.trainee_id',
      where,
      params,
      sort,
      idExpr: 'p.id',
      page,
      map: (r: Row) => shapePlacement(toPlacementRecord(r), actor.role),
    })
  }

  async function get(actor: AuthContext, id: string) {
    const row = await loadScoped(actor, id)
    return shapePlacement(toPlacementRecord(row), actor.role)
  }

  async function transitionStatus(actor: AuthContext, id: string, targetStatus: PlacementStatus, expectedVersion: number, info: ReqInfo) {
    if (actor.role !== 'employer' && !isSuperAdmin(actor)) {
      throw AppError.forbidden('Only employers can update placement status')
    }

    return withTransaction(db, async (tx) => {
      const row = await loadScoped(actor, id, tx, true)
      const current = row.status as PlacementStatus
      const nextStatus = planPlacementTransition(current, targetStatus)

      const { sql, params } = buildUpdate({
        table: 'placements',
        id,
        expectedVersion,
        sets: { status: nextStatus },
        softDeleted: false,
      })
      const r = await tx.query(sql, params)
      if (!r.rowCount) throw AppError.preconditionFailed()

      await writeAudit(tx, audit(actor, info, 'placement.update_status', id, row.employer_id as string, { from: current, to: nextStatus }))

      return get(actor, id)
    })
  }

  return { record, list, get, transitionStatus }
}

export type PlacementsService = ReturnType<typeof createPlacementsService>
