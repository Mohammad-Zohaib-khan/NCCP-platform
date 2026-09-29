import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { buildUpdate, keysetList, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertInstitutionAccess, isSuperAdmin, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { assertInstitutionActive } from '../institutions/service.js'
import { isProgrammeEditable, planProgrammeTransition, type ProgrammeAction, type ProgrammeStatus } from './programmes.state.js'

type Row = Record<string, unknown>
export interface ProgrammeFields { code?: string | null; title: string; description?: string | null; category?: string | null; durationWeeks?: number | null; eligibility?: string | null }
export interface ProgrammeCreate extends ProgrammeFields { institutionId?: string | null }
export interface ProgrammeFilter { q?: string; status?: ProgrammeStatus; category?: string; institutionId?: string; national?: boolean }

const COLS = `p.id, p.code, p.title, p.description, p.category, p.duration_weeks, p.eligibility, p.institution_id, i.name AS institution_name, p.status,
  p.approved_at, p.metadata, p.created_at, p.version,
  (SELECT count(*)::int FROM batches b WHERE b.programme_id = p.id AND b.deleted_at IS NULL) AS batch_count`
const FROM = `programmes p LEFT JOIN institutions i ON i.id = p.institution_id`

export const toProgrammeDto = (r: Row) => ({
  id: r.id as string, code: (r.code as string | null) ?? null, title: r.title as string, description: (r.description as string | null) ?? null, category: (r.category as string | null) ?? null,
  durationWeeks: (r.duration_weeks as number | null) ?? null, eligibility: (r.eligibility as string | null) ?? null,
  institutionId: (r.institution_id as string | null) ?? null, institutionName: (r.institution_name as string | null) ?? null, isNational: r.institution_id == null,
  status: r.status as ProgrammeStatus, rejectionReason: ((r.metadata as Record<string, unknown> | null)?.rejectionReason as string | undefined) ?? null,
  approvedAt: (r.approved_at as Date | null) ?? null, batchCount: r.batch_count as number, createdAt: r.created_at as Date, version: r.version as number,
})

export function createProgrammesService(db: Db) {
  /**
   * Who sees which programmes. Super admin: all. Institution admin and trainer: their institution's programmes plus active national ones.
   * Trainee: active programmes only, national or from their own institution. Employers see none.
   */
  function visibility(actor: AuthContext, params: unknown[]): string {
    if (isSuperAdmin(actor)) return 'TRUE'
    if (actor.role === 'institution_admin' || actor.role === 'trainer') {
      params.push(actor.institutionIds)
      return `(p.institution_id = ANY($${params.length}::uuid[]) OR (p.institution_id IS NULL AND p.status = 'active'))`
    }
    if (actor.role === 'trainee') {
      params.push(actor.institutionIds)
      return `(p.status = 'active' AND (p.institution_id IS NULL OR p.institution_id = ANY($${params.length}::uuid[])))`
    }
    return 'FALSE'
  }

  async function load(actor: AuthContext, id: string, client: Db | Tx = db, lock = false): Promise<Row> {
    const params: unknown[] = [id]
    const vis = visibility(actor, params)
    const r = await client.query(`SELECT ${COLS} FROM ${FROM} WHERE p.id = $1 AND p.deleted_at IS NULL AND ${vis}${lock ? ' FOR UPDATE OF p' : ''}`, params)
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('Programme')
    return row
  }
  /** Writes (edit, submit, archive, delete) are limited to the owning institution's admins, and to super admins for everything. */
  function assertCanWrite(actor: AuthContext, row: Row): void {
    if (isSuperAdmin(actor)) return
    if (row.institution_id == null) throw AppError.forbidden('National programmes can only be managed by NCCP administrators')
    assertInstitutionAccess(actor, row.institution_id as string, 'Programme')
  }

  async function list(actor: AuthContext, f: ProgrammeFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['p.deleted_at IS NULL', visibility(actor, params)]
    if (f.status) { params.push(f.status); where.push(`p.status = $${params.length}`) }
    if (f.category) { params.push(f.category); where.push(`p.category = $${params.length}`) }
    if (f.institutionId) { params.push(f.institutionId); where.push(`p.institution_id = $${params.length}::uuid`) }
    if (f.national !== undefined) where.push(f.national ? 'p.institution_id IS NULL' : 'p.institution_id IS NOT NULL')
    if (f.q) { params.push(likePattern(f.q)); where.push(`(p.title ILIKE $${params.length} OR p.code ILIKE $${params.length})`) }
    return keysetList(db, { select: COLS, from: FROM, where, params, sort, idExpr: 'p.id', page, map: toProgrammeDto })
  }

  async function get(actor: AuthContext, id: string) { return toProgrammeDto(await load(actor, id)) }

  async function create(actor: AuthContext, input: ProgrammeCreate, info: ReqInfo) {
    let institutionId: string | null
    if (isSuperAdmin(actor)) institutionId = input.institutionId ?? null
    else {
      institutionId = input.institutionId ?? (actor.institutionIds.length === 1 ? actor.institutionIds[0] ?? null : null)
      if (!institutionId) throw AppError.validation([{ path: 'institutionId', message: 'institutionId is required' }])
      assertInstitutionAccess(actor, institutionId, 'Institution')
    }
    const id = await withTransaction(db, async (tx) => {
      if (institutionId) await assertInstitutionActive(tx, institutionId)
      let newId: string
      try {
        newId = ((await tx.query(
          `INSERT INTO programmes (code, title, description, category, duration_weeks, eligibility, institution_id, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8) RETURNING id`,
          [input.code ?? null, input.title.trim(), input.description ?? null, input.category ?? null, input.durationWeeks ?? null, input.eligibility ?? null, institutionId, actor.userId])).rows[0] as Row).id as string
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw AppError.conflict('A programme with this code already exists')
        throw err
      }
      await writeAudit(tx, { action: 'programme.create', actorUserId: actor.userId, actorRole: actor.role, entityType: 'programme', entityId: newId, institutionId, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes: { title: input.title, national: institutionId == null } })
      return newId
    })
    return get(actor, id)
  }

  async function update(actor: AuthContext, id: string, patch: Partial<ProgrammeFields>, expectedVersion: number, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const current = await load(actor, id, tx, true)
      assertCanWrite(actor, current)
      if (!isProgrammeEditable(current.status as ProgrammeStatus)) throw AppError.conflict(`A ${String(current.status)} programme cannot be edited; only drafts and rejected programmes can`)
      const q = buildUpdate({ table: 'programmes', id, expectedVersion, returning: 'id',
        sets: { code: patch.code, title: patch.title, description: patch.description, category: patch.category, duration_weeks: patch.durationWeeks, eligibility: patch.eligibility } })
      let res
      try { res = await tx.query(q.sql, q.params) } catch (err) {
        if ((err as { code?: string }).code === '23505') throw AppError.conflict('A programme with this code already exists')
        throw err
      }
      if (!res.rows[0]) throw AppError.preconditionFailed()
      await writeAudit(tx, { action: 'programme.update', actorUserId: actor.userId, actorRole: actor.role, entityType: 'programme', entityId: id, institutionId: (current.institution_id as string | null) ?? null, requestId: info.requestId, ip: info.ip, changes: { fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) } })
    })
    return get(actor, id)
  }

  async function transition(actor: AuthContext, id: string, action: ProgrammeAction, reason: string | undefined, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const current = await load(actor, id, tx, true)
      // Submit and archive belong to the owner; approve/reject are super-admin only and enforced inside the state machine.
      if (action === 'submit' || action === 'archive') assertCanWrite(actor, current)
      const plan = planProgrammeTransition(current.status as ProgrammeStatus, action, { national: current.institution_id == null, isSuperAdmin: isSuperAdmin(actor), reason })
      await tx.query(
        `UPDATE programmes SET status = $2,
           approved_by = CASE WHEN $2::text = 'active' THEN $3::uuid ELSE approved_by END,
           approved_at = CASE WHEN $2::text = 'active' THEN now() ELSE approved_at END,
           metadata = CASE WHEN $2::text = 'rejected' THEN jsonb_set(metadata, '{rejectionReason}', to_jsonb($4::text))
                           WHEN $2::text IN ('pending_approval','active') THEN metadata - 'rejectionReason' ELSE metadata END
         WHERE id = $1`, [id, plan.to, actor.userId, plan.reason])
      await writeAudit(tx, { action: `programme.${action}`, actorUserId: actor.userId, actorRole: actor.role, entityType: 'programme', entityId: id, institutionId: (current.institution_id as string | null) ?? null, requestId: info.requestId, ip: info.ip, changes: { from: current.status, to: plan.to, reason: plan.reason } })
    })
    return get(actor, id)
  }

  async function remove(actor: AuthContext, id: string, info: ReqInfo): Promise<void> {
    await withTransaction(db, async (tx) => {
      const current = await load(actor, id, tx, true)
      assertCanWrite(actor, current)
      const n = ((await tx.query(`SELECT count(*)::int AS n FROM batches WHERE programme_id = $1 AND deleted_at IS NULL`, [id])).rows[0] as Row).n as number
      if (n > 0) throw AppError.conflict('The programme still has batches and cannot be deleted', { batches: n })
      await tx.query(`UPDATE programmes SET deleted_at = now() WHERE id = $1`, [id])
      await writeAudit(tx, { action: 'programme.delete', actorUserId: actor.userId, actorRole: actor.role, entityType: 'programme', entityId: id, institutionId: (current.institution_id as string | null) ?? null, requestId: info.requestId, ip: info.ip })
    })
  }

  return { list, get, create, update, transition, remove }
}
export type ProgrammesService = ReturnType<typeof createProgrammesService>
