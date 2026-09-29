import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, type ParsedSort } from '../../lib/list-query.js'
import type { AuthContext } from '../../auth/context.js'

type Row = Record<string, unknown>

export interface NotificationRecord {
  id: string; userId: string; type: string; title: string; body: string | null
  data: Record<string, unknown>; readAt: Date | null; createdAt: Date
}

const COLS = `n.id, n.user_id, n.type, n.title, n.body, n.data, n.read_at, n.created_at`

const toNotificationRecord = (r: Row): NotificationRecord => ({
  id: r.id as string,
  userId: r.user_id as string,
  type: r.type as string,
  title: r.title as string,
  body: (r.body as string | null) ?? null,
  data: (r.data as Record<string, unknown>) ?? {},
  readAt: (r.read_at as Date | null) ?? null,
  createdAt: r.created_at as Date,
})

export interface DispatchNotificationInput {
  userId: string
  type: string
  title: string
  body?: string | null
  data?: Record<string, unknown>
  channels?: Array<'in_app' | 'email' | 'sms'>
}

export function createNotificationsService(db: Db) {

  async function listOwn(actor: AuthContext, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = [actor.userId]
    const where = [`n.user_id = $1`]

    return keysetList(db, {
      select: COLS,
      from: 'notifications n',
      where,
      params,
      sort,
      idExpr: 'n.id',
      page,
      map: (r: Row) => toNotificationRecord(r),
    })
  }

  async function getUnreadCount(actor: AuthContext): Promise<number> {
    const r = await db.query(`SELECT count(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [actor.userId])
    return (r.rows[0] as Row).unread as number
  }

  async function markRead(actor: AuthContext, id: string): Promise<NotificationRecord> {
    const r = await db.query(
      `UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 RETURNING ${COLS}`,
      [id, actor.userId],
    )
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('Notification')
    return toNotificationRecord(row)
  }

  async function markAllRead(actor: AuthContext): Promise<{ count: number }> {
    const r = await db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [actor.userId])
    return { count: r.rowCount ?? 0 }
  }

  async function dispatch(client: Db | Tx, input: DispatchNotificationInput): Promise<string> {
    const channels = input.channels ?? ['in_app']
    const res = await client.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [input.userId, input.type, input.title, input.body ?? null, JSON.stringify(input.data ?? {})],
    )
    const notificationId = (res.rows[0] as Row).id as string

    for (const channel of channels) {
      await client.query(
        `INSERT INTO notification_deliveries (notification_id, channel, status)
         VALUES ($1, $2, $3)
         ON CONFLICT (notification_id, channel) DO NOTHING`,
        [notificationId, channel, channel === 'in_app' ? 'sent' : 'pending'],
      )
    }

    return notificationId
  }

  return { listOwn, getUnreadCount, markRead, markAllRead, dispatch }
}

export type NotificationsService = ReturnType<typeof createNotificationsService>
