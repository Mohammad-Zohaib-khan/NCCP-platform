import type { Db } from '../db/pool.js'
import { AppError } from '../lib/errors.js'
import { can, MFA_REQUIRED_ROLES, type Permission, type RoleCode, isRoleCode } from './permissions.js'

/** The authenticated caller, attached to every protected request as `req.auth`. */
export interface AuthContext {
  userId: string
  role: RoleCode
  sessionId: string
  fullName: string
  email: string
  institutionIds: string[]   // institutions this user belongs to (admin membership, trainer, trainee)
  employerIds: string[]      // employers this user belongs to
  mfaEnabled: boolean
  /** true when the role requires MFA and the user has not enrolled yet: only MFA-setup endpoints are usable. */
  mfaSetupRequired: boolean
}

export function requirePermission(ctx: AuthContext | null | undefined, permission: Permission): asserts ctx is AuthContext {
  if (!ctx) throw AppError.unauthenticated()
  if (!can(ctx.role, permission)) throw AppError.forbidden()
}

export const isSuperAdmin = (a: AuthContext) => a.role === 'super_admin'

/** Institution-level object access. Returns normally or throws 404 (not 403, so existence is not leaked across tenants). */
export function assertInstitutionAccess(a: AuthContext, institutionId: string | null | undefined, resource = 'Resource'): void {
  if (isSuperAdmin(a)) return
  if (!institutionId || !a.institutionIds.includes(institutionId)) throw AppError.notFound(resource)
}
export function assertEmployerAccess(a: AuthContext, employerId: string | null | undefined, resource = 'Resource'): void {
  if (isSuperAdmin(a)) return
  if (!employerId || !a.employerIds.includes(employerId)) throw AppError.notFound(resource)
}
export function assertOwnRecord(a: AuthContext, ownerUserId: string | null | undefined, resource = 'Resource'): void {
  if (isSuperAdmin(a)) return
  if (!ownerUserId || ownerUserId !== a.userId) throw AppError.notFound(resource)
}

export function mfaRequiredFor(role: string): boolean { return isRoleCode(role) && MFA_REQUIRED_ROLES.includes(role) }

/** Load the organisation memberships that define a user's tenant scope. */
export async function loadScope(db: Db, userId: string): Promise<{ institutionIds: string[]; employerIds: string[] }> {
  const r = await db.query<{ institution_ids: string[]; employer_ids: string[] }>(
    `SELECT
       ARRAY(SELECT institution_id FROM institution_users WHERE user_id = $1
             UNION SELECT institution_id FROM trainers WHERE user_id = $1 AND deleted_at IS NULL
             UNION SELECT institution_id FROM trainees WHERE user_id = $1 AND deleted_at IS NULL AND institution_id IS NOT NULL) AS institution_ids,
       ARRAY(SELECT employer_id FROM employer_users WHERE user_id = $1) AS employer_ids`,
    [userId],
  )
  return { institutionIds: r.rows[0]?.institution_ids ?? [], employerIds: r.rows[0]?.employer_ids ?? [] }
}

/**
 * Institutions a list/query may cover. Returns `null` for "unrestricted" (super admin, no filter), otherwise the
 * allowed ids. A requested institution outside the caller's scope is a 404, never a silently empty result.
 */
export function scopeInstitutionIds(actor: AuthContext, requested?: string | null): string[] | null {
  if (isSuperAdmin(actor)) return requested ? [requested] : null
  if (requested) {
    if (!actor.institutionIds.includes(requested)) throw AppError.notFound('Institution')
    return [requested]
  }
  return actor.institutionIds
}

/**
 * Which institution a create request targets. Institution admins with exactly one institution may omit it; anyone
 * else must say which one. Access is checked here, so a client-supplied id outside the caller's scope is a 404.
 */
export function resolveInstitutionId(actor: AuthContext, requested?: string | null): string {
  const id = requested ?? (actor.role === 'institution_admin' && actor.institutionIds.length === 1 ? actor.institutionIds[0] : undefined)
  if (!id) throw AppError.validation([{ path: 'institutionId', message: 'institutionId is required' }])
  assertInstitutionAccess(actor, id, 'Institution')
  return id
}
