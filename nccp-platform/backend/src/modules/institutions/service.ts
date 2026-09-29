import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { buildUpdate, keysetList, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertInstitutionAccess, isSuperAdmin, scopeInstitutionIds, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { planInstitutionTransition, type InstitutionAction, type InstitutionStatus } from './state.js'

type Row = Record<string, unknown>
export interface InstitutionFields {
  name: string; code?: string | null; institutionType?: string | null; state?: string | null; district?: string | null; address?: string | null
  pincode?: string | null; contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null; website?: string | null
}
export interface InstitutionFilter { q?: string; status?: InstitutionStatus; state?: string; institutionType?: string }

const COLS = `i.id, i.code, i.name, i.institution_type, i.state, i.district, i.address, i.pincode, i.contact_name, i.contact_email, i.contact_phone, i.website,
  i.status, i.rejection_reason, i.approved_at, i.created_at, i.updated_at, i.version`
const FIELD_TO_COLUMN: Record<string, string> = {
  name: 'name', code: 'code', institutionType: 'institution_type', state: 'state', district: 'district', address: 'address',
  pincode: 'pincode', contactName: 'contact_name', contactEmail: 'contact_email', contactPhone: 'contact_phone', website: 'website',
}

export const toInstitutionDto = (r: Row) => ({
  id: r.id as string, code: (r.code as string | null) ?? null, name: r.name as string, institutionType: (r.institution_type as string | null) ?? null,
  state: (r.state as string | null) ?? null, district: (r.district as string | null) ?? null, address: (r.address as string | null) ?? null,
  pincode: (r.pincode as string | null) ?? null, contactName: (r.contact_name as string | null) ?? null, contactEmail: (r.contact_email as string | null) ?? null,
  contactPhone: (r.contact_phone as string | null) ?? null, website: (r.website as string | null) ?? null,
  status: r.status as InstitutionStatus, rejectionReason: (r.rejection_reason as string | null) ?? null, approvedAt: (r.approved_at as Date | null) ?? null,
  createdAt: r.created_at as Date, updatedAt: r.updated_at as Date, version: r.version as number,
})

/** Throws 404 if the institution does not exist and 409 if it is not active. Used before creating new records under an institution. */
export async function assertInstitutionActive(db: Db | Tx, institutionId: string): Promise<void> {
  const r = await db.query(`SELECT status FROM institutions WHERE id = $1 AND deleted_at IS NULL`, [institutionId])
  const row = r.rows[0] as Row | undefined
  if (!row) throw AppError.notFound('Institution')
  if (row.status !== 'active') throw AppError.conflict(`The institution is ${String(row.status)}; new records cannot be created until it is active`)
}

const conflictOnUnique = (err: unknown, message: string): never => {
  if ((err as { code?: string }).code === '23505') throw AppError.conflict(message)
  throw err
}
const audit = (actor: AuthContext | null, info: ReqInfo, action: string, id: string, changes?: Record<string, unknown>) =>
  ({ action, actorUserId: actor?.userId ?? null, actorRole: actor?.role ?? null, entityType: 'institution', entityId: id, institutionId: id, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes })

export function createInstitutionsService(db: Db) {
  async function loadScoped(actor: AuthContext, id: string, client: Db | Tx = db, lock = false): Promise<Row> {
    const r = await client.query(`SELECT ${COLS} FROM institutions i WHERE i.id = $1 AND i.deleted_at IS NULL${lock ? ' FOR UPDATE OF i' : ''}`, [id])
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('Institution')
    assertInstitutionAccess(actor, id, 'Institution')
    return row
  }

  async function list(actor: AuthContext, f: InstitutionFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['i.deleted_at IS NULL']
    const ids = scopeInstitutionIds(actor)
    if (ids) { params.push(ids); where.push(`i.id = ANY($${params.length}::uuid[])`) }
    if (f.status) { params.push(f.status); where.push(`i.status = $${params.length}`) }
    if (f.state) { params.push(f.state); where.push(`i.state = $${params.length}`) }
    if (f.institutionType) { params.push(f.institutionType); where.push(`i.institution_type = $${params.length}`) }
    if (f.q) { params.push(likePattern(f.q)); where.push(`(i.name ILIKE $${params.length} OR i.code ILIKE $${params.length})`) }
    return keysetList(db, { select: COLS, from: 'institutions i', where, params, sort, idExpr: 'i.id', page, map: toInstitutionDto })
  }

  async function get(actor: AuthContext, id: string) {
    const row = await loadScoped(actor, id)
    const c = await db.query(
      `SELECT (SELECT count(*)::int FROM trainers t WHERE t.institution_id = $1 AND t.deleted_at IS NULL) AS trainers,
              (SELECT count(*)::int FROM trainees t WHERE t.institution_id = $1 AND t.deleted_at IS NULL) AS trainees,
              (SELECT count(*)::int FROM batches b WHERE b.institution_id = $1 AND b.deleted_at IS NULL) AS batches,
              (SELECT count(*)::int FROM programmes p WHERE p.institution_id = $1 AND p.deleted_at IS NULL) AS programmes,
              (SELECT count(*)::int FROM institution_users iu JOIN users u ON u.id = iu.user_id WHERE iu.institution_id = $1 AND u.role_code = 'institution_admin' AND u.deleted_at IS NULL) AS admins`, [id])
    const counts = c.rows[0] as Row
    return { ...toInstitutionDto(row), counts: { trainers: counts.trainers as number, trainees: counts.trainees as number, batches: counts.batches as number, programmes: counts.programmes as number, admins: counts.admins as number } }
  }

  function insertValues(input: InstitutionFields): unknown[] {
    return [input.name.trim(), input.code ?? null, input.institutionType ?? null, input.state ?? null, input.district ?? null, input.address ?? null,
      input.pincode ?? null, input.contactName ?? null, input.contactEmail ?? null, input.contactPhone ?? null, input.website ?? null]
  }
  const INSERT_SQL = `INSERT INTO institutions (name, code, institution_type, state, district, address, pincode, contact_name, contact_email, contact_phone, website, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending') RETURNING id`

  /** Super admin creates an institution; it starts pending like an applicant and is approved through the status endpoint. */
  async function create(actor: AuthContext, input: InstitutionFields, info: ReqInfo) {
    if (!isSuperAdmin(actor)) throw AppError.forbidden('Only NCCP administrators can create institutions')
    const id = await withTransaction(db, async (tx) => {
      let newId: string
      try { newId = ((await tx.query(INSERT_SQL, insertValues(input))).rows[0] as Row).id as string } catch (err) { return conflictOnUnique(err, 'An institution with this code already exists') }
      await writeAudit(tx, audit(actor, info, 'institution.create', newId, { name: input.name, code: input.code ?? null }))
      return newId
    })
    return get(actor, id)
  }

  /**
   * Public application. Always answers the same way, and does not create a second pending application for the same contact
   * email, so the endpoint neither reveals which emails exist nor lets one caller flood the review queue.
   */
  async function apply(input: InstitutionFields & { contactEmail: string; contactName: string }, info: ReqInfo): Promise<void> {
    await withTransaction(db, async (tx) => {
      const dup = await tx.query(`SELECT 1 FROM institutions WHERE contact_email = $1 AND status = 'pending' AND deleted_at IS NULL LIMIT 1`, [input.contactEmail])
      if (dup.rows[0]) return
      const id = ((await tx.query(INSERT_SQL, insertValues({ ...input, code: null }))).rows[0] as Row).id as string
      await writeAudit(tx, audit(null, info, 'institution.apply', id, { name: input.name, contactEmail: input.contactEmail }))
    })
  }

  async function update(actor: AuthContext, id: string, patch: Partial<InstitutionFields>, expectedVersion: number, info: ReqInfo) {
    if ('code' in patch && patch.code !== undefined && !isSuperAdmin(actor)) throw AppError.forbidden('Only NCCP administrators can change the institution code')
    await withTransaction(db, async (tx) => {
      const current = await loadScoped(actor, id, tx, true)
      if (current.status === 'suspended' && !isSuperAdmin(actor)) throw AppError.conflict('The institution is suspended and cannot be edited')
      const sets: Record<string, unknown> = {}
      for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) sets[column] = (patch as Record<string, unknown>)[field]
      const q = buildUpdate({ table: 'institutions', id, expectedVersion, sets, returning: 'id' })
      let updated
      try { updated = await tx.query(q.sql, q.params) } catch (err) { return conflictOnUnique(err, 'An institution with this code already exists') }
      if (!updated.rows[0]) throw AppError.preconditionFailed()
      await writeAudit(tx, audit(actor, info, 'institution.update', id, { fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) }))
    })
    return get(actor, id)
  }

  async function transition(actor: AuthContext, id: string, action: InstitutionAction, reason: string | undefined, info: ReqInfo) {
    if (!isSuperAdmin(actor)) throw AppError.forbidden()
    await withTransaction(db, async (tx) => {
      const current = await loadScoped(actor, id, tx, true)
      const plan = planInstitutionTransition(current.status as InstitutionStatus, action, reason)
      // Only rejection keeps its reason in the row; suspension reasons live in the audit trail (no dedicated column yet).
      await tx.query(
        `UPDATE institutions SET status = $2,
           approved_by = CASE WHEN $3::text = 'approve' THEN $4::uuid ELSE approved_by END,
           approved_at = CASE WHEN $3::text = 'approve' THEN now() ELSE approved_at END,
           rejection_reason = CASE WHEN $3::text = 'reject' THEN $5::text WHEN $3::text IN ('approve','reopen') THEN NULL ELSE rejection_reason END
         WHERE id = $1`, [id, plan.to, action, actor.userId, plan.reason])
      await writeAudit(tx, audit(actor, info, `institution.${action}`, id, { from: current.status, to: plan.to, reason: plan.reason }))
    })
    return get(actor, id)
  }

  const adminRows = (id: string, client: Db | Tx = db) => client.query(
    `SELECT u.id AS user_id, u.full_name, u.email, u.status AS user_status, iu.org_role, iu.created_at
       FROM institution_users iu JOIN users u ON u.id = iu.user_id
      WHERE iu.institution_id = $1 AND u.role_code = 'institution_admin' AND u.deleted_at IS NULL ORDER BY iu.created_at, u.id`, [id])
  const toAdmin = (r: Row) => ({ userId: r.user_id as string, fullName: r.full_name as string, email: r.email as string, userStatus: r.user_status as string, orgRole: r.org_role as string, assignedAt: r.created_at as Date })

  async function listAdmins(actor: AuthContext, id: string) {
    await loadScoped(actor, id)
    return { data: (await adminRows(id)).rows.map((r) => toAdmin(r as Row)) }
  }

  async function assignAdmin(actor: AuthContext, id: string, userId: string, orgRole: 'owner' | 'admin', info: ReqInfo) {
    if (!isSuperAdmin(actor)) throw AppError.forbidden()
    await withTransaction(db, async (tx) => {
      await loadScoped(actor, id, tx, true)
      const u = await tx.query(`SELECT role_code FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId])
      const user = u.rows[0] as Row | undefined
      if (!user) throw AppError.notFound('User')
      if (user.role_code !== 'institution_admin') throw AppError.validation([{ path: 'userId', message: 'Only users with the institution_admin role can be assigned' }])
      await tx.query(`INSERT INTO institution_users (institution_id, user_id, org_role) VALUES ($1,$2,$3) ON CONFLICT (institution_id, user_id) DO UPDATE SET org_role = EXCLUDED.org_role`, [id, userId, orgRole])
      await writeAudit(tx, audit(actor, info, 'institution.admin_assign', id, { userId, orgRole }))
    })
    return listAdmins(actor, id)
  }

  async function removeAdmin(actor: AuthContext, id: string, userId: string, info: ReqInfo): Promise<void> {
    if (!isSuperAdmin(actor)) throw AppError.forbidden()
    await withTransaction(db, async (tx) => {
      const inst = await loadScoped(actor, id, tx, true) // row lock serialises concurrent removals
      const admins = (await adminRows(id, tx)).rows as Row[]
      if (!admins.some((a) => a.user_id === userId)) throw AppError.notFound('Administrator')
      if (inst.status === 'active' && admins.length <= 1) throw AppError.conflict('An active institution must keep at least one administrator')
      await tx.query(`DELETE FROM institution_users WHERE institution_id = $1 AND user_id = $2`, [id, userId])
      await writeAudit(tx, audit(actor, info, 'institution.admin_remove', id, { userId }))
    })
  }

  async function remove(actor: AuthContext, id: string, info: ReqInfo): Promise<void> {
    if (!isSuperAdmin(actor)) throw AppError.forbidden()
    await withTransaction(db, async (tx) => {
      await loadScoped(actor, id, tx, true)
      const c = await tx.query(
        `SELECT (SELECT count(*)::int FROM trainers WHERE institution_id = $1 AND deleted_at IS NULL) AS trainers,
                (SELECT count(*)::int FROM trainees WHERE institution_id = $1 AND deleted_at IS NULL) AS trainees,
                (SELECT count(*)::int FROM batches WHERE institution_id = $1 AND deleted_at IS NULL) AS batches`, [id])
      const n = c.rows[0] as Row
      if ((n.trainers as number) + (n.trainees as number) + (n.batches as number) > 0)
        throw AppError.conflict('The institution still has trainers, trainees or batches and cannot be deleted', { trainers: n.trainers, trainees: n.trainees, batches: n.batches })
      await tx.query(`UPDATE institutions SET deleted_at = now() WHERE id = $1`, [id])
      await writeAudit(tx, audit(actor, info, 'institution.delete', id))
    })
  }

  return { list, get, create, apply, update, transition, listAdmins, assignAdmin, removeAdmin, remove }
}
export type InstitutionsService = ReturnType<typeof createInstitutionsService>
