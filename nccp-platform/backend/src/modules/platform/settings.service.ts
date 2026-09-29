import type { Db } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import { writeAudit } from '../../audit/audit.js'
import { isSuperAdmin, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'

type Row = Record<string, unknown>

export interface SystemSettingRecord {
  key: string
  value: unknown
  description: string | null
  isPublic: boolean
  updatedBy: string | null
  updatedAt: Date
  version: number
}

const toSettingRecord = (r: Row): SystemSettingRecord => ({
  key: r.key as string,
  value: r.value,
  description: (r.description as string | null) ?? null,
  isPublic: Boolean(r.is_public),
  updatedBy: (r.updated_by as string | null) ?? null,
  updatedAt: r.updated_at as Date,
  version: r.version as number,
})

export function createSettingsService(db: Db) {

  async function getPublic(): Promise<Record<string, unknown>> {
    const r = await db.query(`SELECT key, value FROM system_settings WHERE is_public = TRUE ORDER BY key`)
    const result: Record<string, unknown> = {}
    for (const row of r.rows as Row[]) {
      result[row.key as string] = row.value
    }
    return result
  }

  async function listAll(actor: AuthContext): Promise<SystemSettingRecord[]> {
    if (!isSuperAdmin(actor)) throw AppError.forbidden()
    const r = await db.query(`SELECT key, value, description, is_public, updated_by, updated_at, version FROM system_settings ORDER BY key`)
    return (r.rows as Row[]).map(toSettingRecord)
  }

  async function get(actor: AuthContext, key: string): Promise<SystemSettingRecord> {
    if (!isSuperAdmin(actor)) throw AppError.forbidden()
    const r = await db.query(`SELECT key, value, description, is_public, updated_by, updated_at, version FROM system_settings WHERE key = $1`, [key])
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('Setting')
    return toSettingRecord(row)
  }

  async function update(actor: AuthContext, key: string, value: unknown, expectedVersion: number, info: ReqInfo): Promise<SystemSettingRecord> {
    if (!isSuperAdmin(actor)) throw AppError.forbidden()

    return withTransaction(db, async (tx) => {
      const existingRes = await tx.query(`SELECT key, value, version FROM system_settings WHERE key = $1 FOR UPDATE`, [key])
      const existing = existingRes.rows[0] as Row | undefined
      if (!existing) throw AppError.notFound('Setting')

      if ((existing.version as number) !== expectedVersion) {
        throw AppError.preconditionFailed()
      }

      const r = await tx.query(
        `UPDATE system_settings
            SET value = $1::jsonb, updated_by = $2, updated_at = now()
          WHERE key = $3 AND version = $4
          RETURNING key, value, description, is_public, updated_by, updated_at, version`,
        [JSON.stringify(value), actor.userId, key, expectedVersion],
      )
      if (!r.rowCount) throw AppError.preconditionFailed()

      await writeAudit(tx, {
        action: 'settings.update',
        actorUserId: actor.userId,
        actorRole: actor.role,
        entityType: 'system_setting',
        entityId: key,
        requestId: info.requestId,
        ip: info.ip,
        userAgent: info.userAgent,
        changes: { key, oldValue: existing.value, newValue: value },
      })

      return toSettingRecord(r.rows[0] as Row)
    })
  }

  return { getPublic, listAll, get, update }
}

export type SettingsService = ReturnType<typeof createSettingsService>
