import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, likePattern, buildUpdate, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertEmployerAccess, isSuperAdmin, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { planEmployerTransition, type EmployerAction, type EmployerStatus } from './employment.rules.js'
import { toEmployerRecord, shapeEmployer } from './employment.dto.js'

type Row = Record<string, unknown>

export interface EmployerFields {
  name: string; sector?: string | null; location?: string | null; website?: string | null; about?: string | null
  registrationNo?: string | null; contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null
}
export interface EmployerFilter { q?: string; verificationStatus?: EmployerStatus }

const COLS = `e.id, e.name, e.sector, e.location, e.website, e.about, e.registration_no, e.contact_name, e.contact_email, e.contact_phone,
  e.verification_status, e.rejection_reason, e.verified_at, e.created_at, e.updated_at, e.version`
const FIELD_TO_COLUMN: Record<string, string> = {
  name: 'name', sector: 'sector', location: 'location', website: 'website', about: 'about',
  registrationNo: 'registration_no', contactName: 'contact_name', contactEmail: 'contact_email', contactPhone: 'contact_phone',
}

const audit = (actor: AuthContext | null, info: ReqInfo, action: string, id: string, employerId?: string, changes?: Record<string, unknown>) =>
  ({ action, actorUserId: actor?.userId ?? null, actorRole: actor?.role ?? null, entityType: 'employer', entityId: id, employerId: employerId ?? id, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes })

const conflictOnUnique = (err: unknown, message: string): never => {
  if ((err as { code?: string }).code === '23505') throw AppError.conflict(message)
  throw err
}

export function createEmployersService(db: Db) {

  async function loadScoped(actor: AuthContext, id: string, client: Db | Tx = db, lock = false): Promise<Row> {
    const r = await client.query(`SELECT ${COLS} FROM employers e WHERE e.id = $1 AND e.deleted_at IS NULL${lock ? ' FOR UPDATE OF e' : ''}`, [id])
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('Employer')
    assertEmployerAccess(actor, id, 'Employer')
    return row
  }

  /** Employers visible to the caller. Super admin sees all; employer users see their own; institution admins see verified; trainees see verified. */
  function visibility(actor: AuthContext, params: unknown[]): string | null {
    if (isSuperAdmin(actor)) return null
    if (actor.role === 'employer') { params.push(actor.employerIds); return `e.id = ANY($${params.length}::uuid[])` }
    // institution admins and trainees see only verified employers
    return `e.verification_status = 'verified'`
  }

  async function list(actor: AuthContext, f: EmployerFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['e.deleted_at IS NULL']
    const vis = visibility(actor, params)
    if (vis) where.push(vis)
    if (f.verificationStatus) { params.push(f.verificationStatus); where.push(`e.verification_status = $${params.length}`) }
    if (f.q) { params.push(likePattern(f.q)); where.push(`(e.name ILIKE $${params.length} OR e.sector ILIKE $${params.length})`) }
    return keysetList(db, { select: COLS, from: 'employers e', where, params, sort, idExpr: 'e.id', page, map: (r: Row) => shapeEmployer(toEmployerRecord(r), actor.role) })
  }

  async function get(actor: AuthContext, id: string) {
    const row = await loadScoped(actor, id)
    const c = await db.query(
      `SELECT (SELECT count(*)::int FROM jobs j WHERE j.employer_id = $1 AND j.deleted_at IS NULL) AS jobs,
              (SELECT count(*)::int FROM placements p WHERE p.employer_id = $1) AS placements,
              (SELECT count(*)::int FROM employer_users eu WHERE eu.employer_id = $1) AS members`, [id])
    const counts = c.rows[0] as Row
    return { ...shapeEmployer(toEmployerRecord(row), actor.role), counts: { jobs: counts.jobs as number, placements: counts.placements as number, members: counts.members as number } }
  }

  /**
   * Public registration: always 202, deduplicates pending by contact email, rate-limited in routes.
   * The same semantics as institution apply: never leak existence.
   */
  async function applyPublic(input: EmployerFields, info: ReqInfo): Promise<void> {
    const email = input.contactEmail?.toLowerCase().trim()
    if (!input.name?.trim()) throw AppError.validation([{ path: 'name', message: 'Employer name is required' }])
    await withTransaction(db, async (tx) => {
      if (email) {
        const dup = await tx.query(`SELECT id FROM employers WHERE contact_email = $1 AND verification_status IN ('unverified','pending') AND deleted_at IS NULL`, [email])
        if (dup.rows.length) return // silent dedup
      }
      const r = await tx.query(
        `INSERT INTO employers (name, sector, location, website, about, registration_no, contact_name, contact_email, contact_phone, verification_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING id`,
        [input.name.trim(), input.sector ?? null, input.location ?? null, input.website ?? null, input.about ?? null,
         input.registrationNo ?? null, input.contactName ?? null, email ?? null, input.contactPhone ?? null])
      const id = (r.rows[0] as Row).id as string
      await writeAudit(tx, audit(null, info, 'employer.apply', id, id, { name: input.name }))
    })
  }

  async function create(actor: AuthContext, input: EmployerFields, info: ReqInfo) {
    if (!isSuperAdmin(actor)) throw AppError.forbidden('Only NCCP administrators can create employers directly')
    if (!input.name?.trim()) throw AppError.validation([{ path: 'name', message: 'Employer name is required' }])
    const id = await withTransaction(db, async (tx) => {
      let newId: string
      try {
        newId = ((await tx.query(
          `INSERT INTO employers (name, sector, location, website, about, registration_no, contact_name, contact_email, contact_phone)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [input.name.trim(), input.sector ?? null, input.location ?? null, input.website ?? null, input.about ?? null,
           input.registrationNo ?? null, input.contactName ?? null, input.contactEmail ?? null, input.contactPhone ?? null]
        )).rows[0] as Row).id as string
      } catch (err) { return conflictOnUnique(err, 'An employer with this contact email already exists') }
      await writeAudit(tx, audit(actor, info, 'employer.create', newId, newId, { name: input.name }))
      return newId
    })
    return get(actor, id)
  }

  async function update(actor: AuthContext, id: string, input: Partial<EmployerFields>, expectedVersion: number, info: ReqInfo) {
    await loadScoped(actor, id)
    const sets: Record<string, unknown> = {}
    for (const [key, col] of Object.entries(FIELD_TO_COLUMN)) if ((input as Record<string, unknown>)[key] !== undefined) sets[col] = (input as Record<string, unknown>)[key]
    if (!Object.keys(sets).length) throw AppError.validation([{ path: 'body', message: 'Nothing to update' }])
    const { sql, params } = buildUpdate({ table: 'employers', id, expectedVersion, sets })
    const r = await withTransaction(db, async (tx) => {
      const result = await tx.query(sql, params)
      if (!result.rowCount) throw AppError.preconditionFailed()
      await writeAudit(tx, audit(actor, info, 'employer.update', id, id, sets))
      return result
    })
    return get(actor, id)
  }

  async function transition(actor: AuthContext, id: string, action: EmployerAction, reason: string | undefined | null, info: ReqInfo) {
    if (!isSuperAdmin(actor)) throw AppError.forbidden()
    return withTransaction(db, async (tx) => {
      const row = await loadScoped(actor, id, tx, true)
      const current = row.verification_status as EmployerStatus
      const plan = planEmployerTransition(current, action, reason)
      const sets: Record<string, unknown> = { verification_status: plan.to }
      if (plan.to === 'rejected') sets.rejection_reason = plan.reason
      if (plan.to === 'verified') { sets.verified_by = actor.userId; sets.verified_at = new Date() }
      if (plan.to === 'pending') sets.rejection_reason = null
      const { sql, params } = buildUpdate({ table: 'employers', id, expectedVersion: row.version as number, sets })
      const r = await tx.query(sql, params)
      if (!r.rowCount) throw AppError.preconditionFailed()
      await writeAudit(tx, audit(actor, info, `employer.${action}`, id, id, { from: current, to: plan.to, reason: plan.reason }))
      return get(actor, id)
    })
  }

  /** Add a user to the employer's team. */
  async function addMember(actor: AuthContext, employerId: string, userId: string, orgRole: string, info: ReqInfo) {
    await loadScoped(actor, employerId)
    try {
      await withTransaction(db, async (tx) => {
        await tx.query(`INSERT INTO employer_users (employer_id, user_id, org_role) VALUES ($1, $2, $3)`, [employerId, userId, orgRole])
        await writeAudit(tx, audit(actor, info, 'employer.member_add', employerId, employerId, { userId, orgRole }))
      })
    } catch (err) { conflictOnUnique(err, 'User is already a member of this employer') }
  }

  async function removeMember(actor: AuthContext, employerId: string, userId: string, info: ReqInfo) {
    await loadScoped(actor, employerId)
    await withTransaction(db, async (tx) => {
      const r = await tx.query(`DELETE FROM employer_users WHERE employer_id = $1 AND user_id = $2`, [employerId, userId])
      if (!r.rowCount) throw AppError.notFound('Member')
      await writeAudit(tx, audit(actor, info, 'employer.member_remove', employerId, employerId, { userId }))
    })
  }

  async function listMembers(actor: AuthContext, employerId: string) {
    await loadScoped(actor, employerId)
    const r = await db.query(
      `SELECT eu.user_id, eu.org_role, eu.created_at, u.email, u.full_name FROM employer_users eu JOIN users u ON u.id = eu.user_id WHERE eu.employer_id = $1 ORDER BY eu.created_at`, [employerId])
    return (r.rows as Row[]).map((r) => ({ userId: r.user_id as string, orgRole: r.org_role as string, createdAt: r.created_at as Date, email: r.email as string, fullName: r.full_name as string }))
  }

  return { list, get, applyPublic, create, update, transition, addMember, removeMember, listMembers }
}

export type EmployersService = ReturnType<typeof createEmployersService>
