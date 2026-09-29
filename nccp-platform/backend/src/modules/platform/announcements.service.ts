import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, buildUpdate, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertInstitutionAccess, isSuperAdmin, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'

type Row = Record<string, unknown>

export type AnnouncementAudience = 'all' | 'trainers' | 'trainees' | 'institution_admins' | 'employers'

export interface AnnouncementRecord {
  id: string; institutionId: string | null; batchId: string | null; audience: AnnouncementAudience
  title: string; body: string; publishedAt: Date | null; expiresAt: Date | null
  createdAt: Date; updatedAt: Date; version: number
}

export interface AnnouncementInput {
  institutionId?: string | null; batchId?: string | null; audience: AnnouncementAudience
  title: string; body: string; publishedAt?: Date | string | null; expiresAt?: Date | string | null
}

export interface AnnouncementFilter {
  institutionId?: string; audience?: AnnouncementAudience; q?: string
}

const COLS = `a.id, a.institution_id, a.batch_id, a.audience, a.title, a.body,
  a.published_at, a.expires_at, a.created_at, a.updated_at, a.version`

const toAnnouncementRecord = (r: Row): AnnouncementRecord => ({
  id: r.id as string,
  institutionId: (r.institution_id as string | null) ?? null,
  batchId: (r.batch_id as string | null) ?? null,
  audience: r.audience as AnnouncementAudience,
  title: r.title as string,
  body: r.body as string,
  publishedAt: (r.published_at as Date | null) ?? null,
  expiresAt: (r.expires_at as Date | null) ?? null,
  createdAt: r.created_at as Date,
  updatedAt: r.updated_at as Date,
  version: r.version as number,
})

const audit = (actor: AuthContext | null, info: ReqInfo, action: string, id: string, institutionId?: string | null, changes?: Record<string, unknown>) =>
  ({ action, actorUserId: actor?.userId ?? null, actorRole: actor?.role ?? null, entityType: 'announcement', entityId: id, institutionId: institutionId ?? null, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes })

export function createAnnouncementsService(db: Db) {

  function visibility(actor: AuthContext, params: unknown[]): string | null {
    if (isSuperAdmin(actor)) return null

    // Non-superadmin: must be published and not expired
    const conds: string[] = [
      `a.published_at IS NOT NULL AND a.published_at <= now()`,
      `(a.expires_at IS NULL OR a.expires_at > now())`,
    ]

    // Audience filter: 'all' or matches the role plural
    const roleAudienceMap: Record<string, string> = {
      institution_admin: 'institution_admins',
      trainer: 'trainers',
      trainee: 'trainees',
      employer: 'employers',
    }
    const aud = roleAudienceMap[actor.role] ?? 'all'
    params.push(aud)
    conds.push(`a.audience IN ('all', $${params.length})`)

    // Institution filter: national (institution_id IS NULL) or in caller's institutionIds
    if (actor.institutionIds.length) {
      params.push(actor.institutionIds)
      conds.push(`(a.institution_id IS NULL OR a.institution_id = ANY($${params.length}::uuid[]))`)
    } else {
      conds.push(`a.institution_id IS NULL`)
    }

    return conds.join(' AND ')
  }

  async function list(actor: AuthContext, f: AnnouncementFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['a.deleted_at IS NULL']
    const vis = visibility(actor, params)
    if (vis) where.push(`(${vis})`)

    if (f.institutionId) { params.push(f.institutionId); where.push(`a.institution_id = $${params.length}`) }
    if (f.audience) { params.push(f.audience); where.push(`a.audience = $${params.length}`) }
    if (f.q) { params.push(likePattern(f.q)); where.push(`(a.title ILIKE $${params.length} OR a.body ILIKE $${params.length})`) }

    return keysetList(db, {
      select: COLS,
      from: 'announcements a',
      where,
      params,
      sort,
      idExpr: 'a.id',
      page,
      map: (r: Row) => toAnnouncementRecord(r),
    })
  }

  async function get(actor: AuthContext, id: string) {
    const r = await db.query(`SELECT ${COLS} FROM announcements a WHERE a.id = $1 AND a.deleted_at IS NULL`, [id])
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('Announcement')

    const ann = toAnnouncementRecord(row)
    if (!isSuperAdmin(actor)) {
      if (ann.institutionId && !actor.institutionIds.includes(ann.institutionId)) {
        throw AppError.notFound('Announcement')
      }
    }
    return ann
  }

  async function create(actor: AuthContext, input: AnnouncementInput, info: ReqInfo) {
    if (!isSuperAdmin(actor)) {
      if (!input.institutionId) throw AppError.forbidden('Only NCCP super administrators can create national announcements')
      assertInstitutionAccess(actor, input.institutionId, 'Institution')
    }

    if (!input.title?.trim()) throw AppError.validation([{ path: 'title', message: 'Announcement title is required' }])
    if (!input.body?.trim()) throw AppError.validation([{ path: 'body', message: 'Announcement body is required' }])

    const pubAt = input.publishedAt ? new Date(input.publishedAt) : new Date()
    const expAt = input.expiresAt ? new Date(input.expiresAt) : null

    const id = await withTransaction(db, async (tx) => {
      const res = await tx.query(
        `INSERT INTO announcements (institution_id, batch_id, audience, title, body, published_at, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [input.institutionId ?? null, input.batchId ?? null, input.audience, input.title.trim(), input.body.trim(), pubAt, expAt, actor.userId],
      )
      const newId = (res.rows[0] as Row).id as string
      await writeAudit(tx, audit(actor, info, 'announcement.create', newId, input.institutionId, { title: input.title, audience: input.audience }))
      return newId
    })

    return get(actor, id)
  }

  async function update(actor: AuthContext, id: string, input: Partial<AnnouncementInput>, expectedVersion: number, info: ReqInfo) {
    const existing = await get(actor, id)
    if (!isSuperAdmin(actor)) {
      if (!existing.institutionId) throw AppError.forbidden('Only NCCP super administrators can edit national announcements')
      assertInstitutionAccess(actor, existing.institutionId, 'Institution')
    }

    const sets: Record<string, unknown> = {}
    if (input.title !== undefined) sets.title = input.title.trim()
    if (input.body !== undefined) sets.body = input.body.trim()
    if (input.audience !== undefined) sets.audience = input.audience
    if (input.publishedAt !== undefined) sets.published_at = input.publishedAt ? new Date(input.publishedAt) : null
    if (input.expiresAt !== undefined) sets.expires_at = input.expiresAt ? new Date(input.expiresAt) : null

    const { sql, params } = buildUpdate({ table: 'announcements', id, expectedVersion, sets })
    await withTransaction(db, async (tx) => {
      const r = await tx.query(sql, params)
      if (!r.rowCount) throw AppError.preconditionFailed()
      await writeAudit(tx, audit(actor, info, 'announcement.update', id, existing.institutionId, sets))
    })

    return get(actor, id)
  }

  async function remove(actor: AuthContext, id: string, info: ReqInfo): Promise<void> {
    const existing = await get(actor, id)
    if (!isSuperAdmin(actor)) {
      if (!existing.institutionId) throw AppError.forbidden()
      assertInstitutionAccess(actor, existing.institutionId, 'Institution')
    }

    await withTransaction(db, async (tx) => {
      await tx.query(`UPDATE announcements SET deleted_at = now() WHERE id = $1`, [id])
      await writeAudit(tx, audit(actor, info, 'announcement.delete', id, existing.institutionId))
    })
  }

  return { list, get, create, update, remove }
}

export type AnnouncementsService = ReturnType<typeof createAnnouncementsService>
