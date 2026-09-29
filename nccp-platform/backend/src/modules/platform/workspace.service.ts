import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import type { AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { writeAudit } from '../../audit/audit.js'

export interface WorkspaceRecordDto {
  id: string
  workspace: string
  module: string
  data: Record<string, unknown>
  status: string
  version: number
  createdAt: Date
  updatedAt: Date
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createWorkspaceService(db: Db) {
  async function listRecords(workspace: string, module?: string): Promise<WorkspaceRecordDto[]> {
    const params: unknown[] = [workspace]
    let sql = `SELECT id, workspace, module, data, status, version, created_at, updated_at
               FROM workspace_records
               WHERE workspace = $1`
    if (module) {
      params.push(module)
      sql += ` AND module = $2`
    }
    sql += ` ORDER BY updated_at DESC`

    const res = await db.query(sql, params)
    return res.rows.map((r) => ({
      id: r.id as string,
      workspace: r.workspace as string,
      module: r.module as string,
      data: r.data as Record<string, unknown>,
      status: r.status as string,
      version: r.version as number,
      createdAt: r.created_at as Date,
      updatedAt: r.updated_at as Date,
    }))
  }

  async function saveRecord(
    actor: AuthContext,
    workspace: string,
    module: string,
    record: { id: string; data: Record<string, unknown>; status?: string },
    info: ReqInfo
  ): Promise<WorkspaceRecordDto> {
    const status = record.status || 'Active'

    const res = await withTransaction(db, async (tx: Tx) => {
      const q = `INSERT INTO workspace_records (id, workspace, module, data, status, updated_at)
                 VALUES ($1, $2, $3, $4, $5, now())
                 ON CONFLICT (id) DO UPDATE SET
                   data = EXCLUDED.data,
                   status = EXCLUDED.status,
                   updated_at = now()
                 RETURNING id, workspace, module, data, status, version, created_at, updated_at`
      const inserted = (await tx.query(q, [record.id, workspace, module, JSON.stringify(record.data), status])).rows[0]

      const actorUserId = actor.userId && UUID_RE.test(actor.userId) ? actor.userId : null

      await writeAudit(tx, {
        actorUserId,
        actorRole: actor.role || 'system',
        action: 'workspace.save_record',
        entityType: 'workspace_record',
        entityId: record.id,
        changes: { workspace, module, status },
        ip: info.ip,
        userAgent: info.userAgent,
      })

      return inserted
    })

    return {
      id: res.id as string,
      workspace: res.workspace as string,
      module: res.module as string,
      data: res.data as Record<string, unknown>,
      status: res.status as string,
      version: res.version as number,
      createdAt: res.created_at as Date,
      updatedAt: res.updated_at as Date,
    }
  }

  async function deleteRecord(
    actor: AuthContext,
    workspace: string,
    module: string | undefined,
    id: string,
    info: ReqInfo
  ): Promise<{ success: boolean }> {
    await withTransaction(db, async (tx: Tx) => {
      if (module) {
        await tx.query(`DELETE FROM workspace_records WHERE id = $1 AND workspace = $2 AND module = $3`, [id, workspace, module])
      } else {
        await tx.query(`DELETE FROM workspace_records WHERE id = $1 AND workspace = $2`, [id, workspace])
      }
      const actorUserId = actor.userId && UUID_RE.test(actor.userId) ? actor.userId : null
      await writeAudit(tx, {
        actorUserId,
        actorRole: actor.role || 'system',
        action: 'workspace.delete_record',
        entityType: 'workspace_record',
        entityId: id,
        changes: { workspace, module: module ?? null },
        ip: info.ip,
        userAgent: info.userAgent,
      })
    })
    return { success: true }
  }

  async function batchSync(
    actor: AuthContext,
    workspace: string,
    items: Array<{ id: string; module: string; data: Record<string, unknown>; status?: string }>,
    info: ReqInfo
  ): Promise<{ count: number }> {
    await withTransaction(db, async (tx: Tx) => {
      for (const item of items) {
        const status = item.status || 'Active'
        await tx.query(
          `INSERT INTO workspace_records (id, workspace, module, data, status, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (id) DO UPDATE SET
             data = EXCLUDED.data,
             status = EXCLUDED.status,
             updated_at = now()`,
          [item.id, workspace, item.module, JSON.stringify(item.data), status]
        )
      }

      const actorUserId = actor.userId && UUID_RE.test(actor.userId) ? actor.userId : null
      await writeAudit(tx, {
        actorUserId,
        actorRole: actor.role || 'system',
        action: 'workspace.batch_sync',
        entityType: 'workspace',
        entityId: workspace,
        changes: { count: items.length },
        ip: info.ip,
        userAgent: info.userAgent,
      })
    })

    return { count: items.length }
  }

  return { listRecords, saveRecord, deleteRecord, batchSync }
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>

