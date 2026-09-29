import type { Db } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, type ParsedSort } from '../../lib/list-query.js'
import { isSuperAdmin, type AuthContext } from '../../auth/context.js'

type Row = Record<string, unknown>

export interface AuditLogFilter {
  actorUserId?: string
  actorRole?: string
  action?: string
  entityType?: string
  entityId?: string
  institutionId?: string
  employerId?: string
  outcome?: 'success' | 'failure' | 'denied'
  from?: string
  to?: string
}

export interface AuditLogDto {
  id: number
  occurredAt: Date
  actorUserId: string | null
  actorRole: string | null
  action: string
  entityType: string | null
  entityId: string | null
  institutionId: string | null
  employerId: string | null
  outcome: string
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
  changes: Record<string, unknown> | null
}

const COLS = `a.id, a.occurred_at, a.actor_user_id, a.actor_role, a.action, a.entity_type, a.entity_id,
  a.institution_id, a.employer_id, a.outcome, a.request_id, a.ip_address::text AS ip_address,
  a.user_agent, a.changes`

export function createAuditService(db: Db) {

  async function list(actor: AuthContext, f: AuditLogFilter, sort: ParsedSort, page: PageParams) {
    if (!isSuperAdmin(actor)) throw AppError.forbidden('Only NCCP super administrators can view audit logs')

    const params: unknown[] = []
    const where: string[] = []

    if (f.actorUserId) { params.push(f.actorUserId); where.push(`a.actor_user_id = $${params.length}`) }
    if (f.actorRole) { params.push(f.actorRole); where.push(`a.actor_role = $${params.length}`) }
    if (f.action) { params.push(f.action); where.push(`a.action = $${params.length}`) }
    if (f.entityType) { params.push(f.entityType); where.push(`a.entity_type = $${params.length}`) }
    if (f.entityId) { params.push(f.entityId); where.push(`a.entity_id = $${params.length}`) }
    if (f.institutionId) { params.push(f.institutionId); where.push(`a.institution_id = $${params.length}`) }
    if (f.employerId) { params.push(f.employerId); where.push(`a.employer_id = $${params.length}`) }
    if (f.outcome) { params.push(f.outcome); where.push(`a.outcome = $${params.length}`) }
    if (f.from) { params.push(f.from); where.push(`a.occurred_at >= $${params.length}`) }
    if (f.to) { params.push(f.to); where.push(`a.occurred_at <= $${params.length}`) }

    return keysetList(db, {
      select: COLS,
      from: 'audit_logs a',
      where,
      params,
      sort,
      idExpr: 'a.id',
      page,
      map: (r: Row): AuditLogDto => ({
        id: Number(r.id),
        occurredAt: r.occurred_at as Date,
        actorUserId: (r.actor_user_id as string | null) ?? null,
        actorRole: (r.actor_role as string | null) ?? null,
        action: r.action as string,
        entityType: (r.entity_type as string | null) ?? null,
        entityId: (r.entity_id as string | null) ?? null,
        institutionId: (r.institution_id as string | null) ?? null,
        employerId: (r.employer_id as string | null) ?? null,
        outcome: r.outcome as string,
        requestId: (r.request_id as string | null) ?? null,
        ipAddress: (r.ip_address as string | null) ?? null,
        userAgent: (r.user_agent as string | null) ?? null,
        changes: (r.changes as Record<string, unknown> | null) ?? null,
      }),
    })
  }

  return { list }
}

export type AuditService = ReturnType<typeof createAuditService>
