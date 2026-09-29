import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import { buildPage, type PageParams } from '../../lib/pagination.js'
import { mapPage } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertInstitutionAccess, isSuperAdmin, type AuthContext } from '../../auth/context.js'
import { INVITABLE_BY, ROLE_CODES, type RoleCode } from '../../auth/permissions.js'
import type { AuthDeps, ReqInfo } from './service.js'
import type { AuthService } from './service.js'

export interface InviteInput { email: string; fullName: string; phone?: string; role: RoleCode; institutionId?: string; employerId?: string }
export interface UserListFilter { q?: string; role?: string; status?: string }

const USER_COLS = `u.id, u.email, u.full_name, u.phone, u.role_code, u.status, u.email_verified_at, u.last_login_at, u.mfa_enabled, u.created_at, u.version`
const USER_LIST_COLS = `${USER_COLS}, u.created_at::text AS _sort`
const toDto = (r: Record<string, unknown>) => ({
  id: r.id as string, email: r.email as string, fullName: r.full_name as string, phone: (r.phone as string | null) ?? null,
  role: r.role_code as string, status: r.status as string, emailVerified: r.email_verified_at != null,
  lastLoginAt: (r.last_login_at as Date | null) ?? null, mfaEnabled: r.mfa_enabled as boolean, createdAt: r.created_at as Date, version: r.version as number,
})

export function createUsersService(deps: AuthDeps, auth: AuthService) {
  const { db, config } = deps
  void config

  /** SQL fragment restricting which users the caller may see. Returns [clause, params]. */
  function visibility(actor: AuthContext, startIdx: number): { clause: string; params: unknown[] } {
    if (isSuperAdmin(actor)) return { clause: 'TRUE', params: [] }
    if (actor.role === 'institution_admin')
      return { clause: `(u.id = $${startIdx} OR EXISTS (SELECT 1 FROM institution_users iu WHERE iu.user_id = u.id AND iu.institution_id = ANY($${startIdx + 1}::uuid[]))
                          OR EXISTS (SELECT 1 FROM trainers t WHERE t.user_id = u.id AND t.institution_id = ANY($${startIdx + 1}::uuid[]))
                          OR EXISTS (SELECT 1 FROM trainees t WHERE t.user_id = u.id AND t.institution_id = ANY($${startIdx + 1}::uuid[])))`, params: [actor.userId, actor.institutionIds] }
    if (actor.role === 'employer')
      return { clause: `EXISTS (SELECT 1 FROM employer_users eu WHERE eu.user_id = u.id AND eu.employer_id = ANY($${startIdx}::uuid[]))`, params: [actor.employerIds] }
    return { clause: `u.id = $${startIdx}`, params: [actor.userId] }
  }

  async function list(actor: AuthContext, f: UserListFilter, page: PageParams) {
    const vis = visibility(actor, 1)
    const params: unknown[] = [...vis.params]
    const where = [`u.deleted_at IS NULL`, vis.clause]
    if (f.role) { params.push(f.role); where.push(`u.role_code = $${params.length}`) }
    if (f.status) { params.push(f.status); where.push(`u.status = $${params.length}`) }
    if (f.q) { params.push(`%${f.q.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(u.full_name ILIKE $${params.length} OR u.email::text ILIKE $${params.length})`) }
    if (page.cursor) {
      params.push(page.cursor.sort, page.cursor.id)
      where.push(`(u.created_at, u.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
    }
    params.push(page.limit + 1)
    const r = await db.query(`SELECT ${USER_LIST_COLS} FROM users u WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC, u.id DESC LIMIT $${params.length}`, params)
    // Sort value travels as text so timestamps keep their microseconds (a JS Date would truncate to milliseconds).
    const rows = r.rows as Array<Record<string, unknown>>
    return mapPage(buildPage(rows, page.limit, (row) => ({ sort: row._sort as string, id: row.id as string })), toDto)
  }

  async function loadTarget(actor: AuthContext, id: string) {
    const vis = visibility(actor, 2)
    const r = await db.query(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL AND ${vis.clause}`, [id, ...vis.params])
    if (!r.rows[0]) throw AppError.notFound('User') // 404 for out-of-scope users too (no existence leak)
    return r.rows[0] as Record<string, unknown>
  }

  async function get(actor: AuthContext, id: string) { return toDto(await loadTarget(actor, id)) }

  async function invite(actor: AuthContext, input: InviteInput, info: ReqInfo) {
    if (!INVITABLE_BY[actor.role].includes(input.role)) throw AppError.forbidden(`You cannot invite users with role '${input.role}'`)
    let institutionId: string | undefined
    let employerId: string | undefined
    if (input.role === 'institution_admin' || input.role === 'trainer' || input.role === 'trainee') {
      institutionId = input.institutionId ?? (actor.role === 'institution_admin' && actor.institutionIds.length === 1 ? actor.institutionIds[0] : undefined)
      if (!institutionId) throw AppError.validation([{ path: 'institutionId', message: 'institutionId is required for this role' }])
      assertInstitutionAccess(actor, institutionId, 'Institution')
    }
    if (input.role === 'employer') {
      employerId = input.employerId
      if (!employerId) throw AppError.validation([{ path: 'employerId', message: 'employerId is required for the employer role' }])
    }
    const email = input.email.trim().toLowerCase()
    const created = await withTransaction(db, async (tx) => {
      if (institutionId) {
        const inst = await tx.query(`SELECT 1 FROM institutions WHERE id = $1 AND deleted_at IS NULL`, [institutionId])
        if (!inst.rows[0]) throw AppError.notFound('Institution')
      }
      if (employerId) {
        const emp = await tx.query(`SELECT 1 FROM employers WHERE id = $1 AND deleted_at IS NULL`, [employerId])
        if (!emp.rows[0]) throw AppError.notFound('Employer')
      }
      let userId: string
      try {
        const r = await tx.query<{ id: string }>(`INSERT INTO users (email, full_name, phone, role_code, status) VALUES ($1,$2,$3,$4,'invited') RETURNING id`, [email, input.fullName.trim(), input.phone ?? null, input.role])
        userId = r.rows[0]!.id
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw AppError.conflict('A user with this email already exists')
        throw err
      }
      if (institutionId) await tx.query(`INSERT INTO institution_users (institution_id, user_id, org_role) VALUES ($1,$2,$3)`, [institutionId, userId, input.role === 'institution_admin' ? 'admin' : 'member'])
      if (employerId) await tx.query(`INSERT INTO employer_users (employer_id, user_id, org_role) VALUES ($1,$2,'recruiter')`, [employerId, userId])
      const token = await auth.createUserToken(tx, userId, 'invitation', auth.INVITE_TTL_MIN, actor.userId)
      await writeAudit(tx, { action: 'user.invite', actorUserId: actor.userId, actorRole: actor.role, entityType: 'user', entityId: userId, institutionId: institutionId ?? null, employerId: employerId ?? null, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes: { email, role: input.role } })
      return { userId, token }
    })
    // Sent after commit: a mail failure must not roll back the user; the invitation can be re-sent.
    let emailSent = true
    try { await auth.sendInvitationEmail(email, input.fullName, created.token, auth.INVITE_TTL_MIN / 60) } catch { emailSent = false }
    return { user: await get(actor, created.userId), emailSent }
  }

  async function update(actor: AuthContext, id: string, patch: { fullName?: string; phone?: string | null }, expectedVersion: number, info: ReqInfo) {
    const target = await loadTarget(actor, id)
    if (id !== actor.userId && !isSuperAdmin(actor) && !['trainer', 'trainee'].includes(target.role_code as string))
      throw AppError.forbidden('You cannot edit this user')
    const r = await db.query(
      `UPDATE users SET full_name = COALESCE($2, full_name), phone = CASE WHEN $3::boolean THEN $4 ELSE phone END WHERE id = $1 AND version = $5 AND deleted_at IS NULL RETURNING ${USER_COLS.replace(/u\./g, '')}`,
      [id, patch.fullName ?? null, patch.phone !== undefined, patch.phone ?? null, expectedVersion])
    if (!r.rows[0]) throw AppError.preconditionFailed()
    await writeAudit(db, { action: 'user.update', actorUserId: actor.userId, actorRole: actor.role, entityType: 'user', entityId: id, requestId: info.requestId, ip: info.ip, changes: { fields: Object.keys(patch) } })
    return toDto(r.rows[0])
  }

  async function setDisabled(actor: AuthContext, id: string, disabled: boolean, info: ReqInfo) {
    if (id === actor.userId) throw AppError.forbidden('You cannot disable or enable your own account')
    const target = await loadTarget(actor, id)
    if (!isSuperAdmin(actor) && !['trainer', 'trainee'].includes(target.role_code as string)) throw AppError.forbidden('You cannot change this user')
    if (target.status === 'invited' && !disabled) throw AppError.conflict('Invited users become active when they accept the invitation')
    await withTransaction(db, async (tx) => {
      if (disabled) {
        await tx.query(`UPDATE users SET status = 'disabled' WHERE id = $1 AND deleted_at IS NULL`, [id])
        await tx.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'user_disabled' WHERE user_id = $1 AND revoked_at IS NULL`, [id])
      } else {
        await tx.query(`UPDATE users SET status = 'active', failed_login_count = 0, locked_until = NULL WHERE id = $1 AND status IN ('disabled','locked')`, [id])
      }
      await writeAudit(tx, { action: disabled ? 'user.disable' : 'user.enable', actorUserId: actor.userId, actorRole: actor.role, entityType: 'user', entityId: id, requestId: info.requestId, ip: info.ip })
    })
    return get(actor, id)
  }

  /** Super admin only: end every session of a user (e.g. suspected compromise). */
  async function revokeAllSessions(actor: AuthContext, id: string, info: ReqInfo): Promise<number> {
    if (!isSuperAdmin(actor)) throw AppError.forbidden()
    const r = await db.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'revoked_by_admin' WHERE user_id = $1 AND revoked_at IS NULL`, [id])
    await writeAudit(db, { action: 'auth.sessions_revoke_all', actorUserId: actor.userId, actorRole: actor.role, entityType: 'user', entityId: id, requestId: info.requestId, ip: info.ip })
    return r.rowCount ?? 0
  }

  async function listRoles() {
    const roles = await db.query(`SELECT r.code, r.name, r.description, r.workspace,
       COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_code = r.code GROUP BY r.code ORDER BY r.code`)
    return roles.rows.map((r) => ({ code: r.code as string, name: r.name as string, description: r.description as string | null, workspace: r.workspace as string, permissions: r.permissions as string[] }))
  }

  return { list, get, invite, update, setDisabled, revokeAllSessions, listRoles, roleCodes: ROLE_CODES }
}
export type UsersService = ReturnType<typeof createUsersService>
