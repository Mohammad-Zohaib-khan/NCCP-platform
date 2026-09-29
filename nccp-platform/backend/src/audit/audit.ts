import type { Db, Tx } from '../db/pool.js'

export interface AuditEntry {
  action: string                       // e.g. 'auth.login', 'user.invite'
  outcome?: 'success' | 'failure' | 'denied'
  actorUserId?: string | null
  actorRole?: string | null
  entityType?: string
  entityId?: string
  institutionId?: string | null
  employerId?: string | null
  requestId?: string
  ip?: string
  userAgent?: string
  changes?: Record<string, unknown>
}

const SECRET_KEYS = /pass(word)?|secret|token|hash|otp|code|authorization|cookie/i

/** Recursively replace values of secret-looking keys, so credentials can never reach the audit table. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1)]))
}

/** Write one audit row. Pass a Tx to make the audit entry part of the same transaction as the change it records. */
export async function writeAudit(db: Db | Tx, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, institution_id, employer_id, outcome, request_id, ip_address, user_agent, changes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [e.actorUserId ?? null, e.actorRole ?? null, e.action, e.entityType ?? null, e.entityId ?? null, e.institutionId ?? null, e.employerId ?? null,
     e.outcome ?? 'success', e.requestId ?? null, e.ip ?? null, e.userAgent?.slice(0, 500) ?? null, e.changes ? JSON.stringify(redact(e.changes)) : null],
  )
}

/** Best-effort variant for failure/denied events on paths that must not fail because auditing failed. */
export async function writeAuditSafe(db: Db | Tx, e: AuditEntry, onError: (err: unknown) => void): Promise<void> {
  try { await writeAudit(db, e) } catch (err) { onError(err) }
}
