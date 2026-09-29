import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import { parsePageParams } from '../../lib/pagination.js'
import { parseSort } from '../../lib/list-query.js'
import { actorOf, ifMatch, limit, reqInfo, versioned } from '../../lib/http.js'
import type { FilesService } from './files.service.js'
import type { AnnouncementsService } from './announcements.service.js'
import type { NotificationsService } from './notifications.service.js'
import type { SettingsService } from './settings.service.js'
import type { AuditService } from './audit.service.js'

const uuid = z.string().uuid()
const q = (req: { query: unknown }) => req.query as Record<string, unknown>

const announcementSort = {
  published_at: { expr: 'a.published_at', type: 'timestamptz' as const },
  created_at: { expr: 'a.created_at', type: 'timestamptz' as const },
}

const notificationSort = {
  created_at: { expr: 'n.created_at', type: 'timestamptz' as const },
}

const auditSort = {
  occurred_at: { expr: 'a.occurred_at', type: 'timestamptz' as const },
}

export interface PlatformRouteDeps {
  config: AppConfig
  files: FilesService
  announcements: AnnouncementsService
  notifications: NotificationsService
  settings: SettingsService
  audit: AuditService
}

export async function platformRoutes(app: FastifyInstance, deps: PlatformRouteDeps): Promise<void> {
  const { config, files, announcements, notifications, settings, audit } = deps
  const idParam = z.object({ id: uuid })

  // =========================================================================
  // FILES
  // =========================================================================

  app.post('/files/upload', { config: limit(config, 60), preHandler: app.authorize('files:upload') }, async (req, reply) => {
    const body = z.object({
      originalName: z.string().trim().min(1).max(255),
      contentType: z.string().trim().min(1).max(100),
      dataBase64: z.string().min(1),
      purpose: z.enum(['avatar', 'resume', 'course_resource', 'certificate', 'employer_document', 'institution_document', 'other']),
      visibility: z.enum(['private', 'org', 'authenticated']).optional(),
      institutionId: uuid.optional().nullable(),
      employerId: uuid.optional().nullable(),
    }).parse(req.body)

    const buffer = Buffer.from(body.dataBase64, 'base64')
    const file = await files.upload(actorOf(req), {
      originalName: body.originalName,
      contentType: body.contentType,
      data: buffer,
      purpose: body.purpose,
      visibility: body.visibility,
      institutionId: body.institutionId,
      employerId: body.employerId,
    }, reqInfo(req))

    return reply.status(201).send(file)
  })

  app.get('/files/:id', { preHandler: app.authorize('files:read') }, async (req) => {
    const { id } = idParam.parse(req.params)
    return files.get(actorOf(req), id)
  })

  app.get('/files/:id/download', { preHandler: app.authorize('files:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const { meta, data } = await files.download(actorOf(req), id)

    return reply
      .header('content-type', meta.contentType)
      .header('content-disposition', `attachment; filename="${encodeURIComponent(meta.originalName)}"`)
      .header('content-length', data.length)
      .send(data)
  })

  app.delete('/files/:id', { preHandler: app.authorize('files:upload') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    await files.softDelete(actorOf(req), id, reqInfo(req))
    return reply.status(204).send()
  })

  // =========================================================================
  // ANNOUNCEMENTS
  // =========================================================================

  app.get('/announcements', { preHandler: app.authorize('announcements:read') }, async (req) => {
    const f = z.object({
      institutionId: uuid.optional(),
      audience: z.enum(['all', 'trainers', 'trainees', 'institution_admins', 'employers']).optional(),
      q: z.string().trim().max(100).optional(),
    }).parse(req.query)
    return announcements.list(actorOf(req), f, parseSort(q(req).sort, announcementSort, { key: 'published_at', dir: 'DESC' }), parsePageParams(q(req)))
  })

  app.get('/announcements/:id', { preHandler: app.authorize('announcements:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return versioned(reply, await announcements.get(actorOf(req), id))
  })

  app.post('/announcements', { config: limit(config, 60), preHandler: app.authorize('announcements:write') }, async (req, reply) => {
    const body = z.object({
      institutionId: uuid.optional().nullable(),
      batchId: uuid.optional().nullable(),
      audience: z.enum(['all', 'trainers', 'trainees', 'institution_admins', 'employers']),
      title: z.string().trim().min(3).max(200),
      body: z.string().trim().min(3).max(5000),
      publishedAt: z.string().datetime().optional().nullable(),
      expiresAt: z.string().datetime().optional().nullable(),
    }).parse(req.body)
    return reply.status(201).send(versioned(reply, await announcements.create(actorOf(req), body, reqInfo(req))))
  })

  app.patch('/announcements/:id', { preHandler: app.authorize('announcements:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({
      title: z.string().trim().min(3).max(200).optional(),
      body: z.string().trim().min(3).max(5000).optional(),
      audience: z.enum(['all', 'trainers', 'trainees', 'institution_admins', 'employers']).optional(),
      publishedAt: z.string().datetime().optional().nullable(),
      expiresAt: z.string().datetime().optional().nullable(),
    }).parse(req.body)
    return versioned(reply, await announcements.update(actorOf(req), id, body, ifMatch(req), reqInfo(req)))
  })

  app.delete('/announcements/:id', { preHandler: app.authorize('announcements:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    await announcements.remove(actorOf(req), id, reqInfo(req))
    return reply.status(204).send()
  })

  // =========================================================================
  // NOTIFICATIONS
  // =========================================================================

  app.get('/notifications', { preHandler: app.authorize('notifications:read_own') }, async (req) => {
    return notifications.listOwn(actorOf(req), parseSort(q(req).sort, notificationSort, { key: 'created_at', dir: 'DESC' }), parsePageParams(q(req)))
  })

  app.get('/notifications/unread-count', { preHandler: app.authorize('notifications:read_own') }, async (req) => {
    return { unread: await notifications.getUnreadCount(actorOf(req)) }
  })

  app.post('/notifications/:id/read', { preHandler: app.authorize('notifications:read_own') }, async (req) => {
    const { id } = idParam.parse(req.params)
    return notifications.markRead(actorOf(req), id)
  })

  app.post('/notifications/read-all', { preHandler: app.authorize('notifications:read_own') }, async (req) => {
    return notifications.markAllRead(actorOf(req))
  })

  // =========================================================================
  // SETTINGS
  // =========================================================================

  // Public unauthenticated system settings (safe branding, config, public flags)
  app.get('/settings/public', { config: limit(config, 60) }, async () => {
    return settings.getPublic()
  })

  app.get('/settings', { preHandler: app.authorize('settings:read') }, async (req) => {
    return settings.listAll(actorOf(req))
  })

  app.get('/settings/:key', { preHandler: app.authorize('settings:read') }, async (req, reply) => {
    const { key } = z.object({ key: z.string().min(1).max(100) }).parse(req.params)
    return versioned(reply, await settings.get(actorOf(req), key))
  })

  app.put('/settings/:key', { preHandler: app.authorize('settings:write') }, async (req, reply) => {
    const { key } = z.object({ key: z.string().min(1).max(100) }).parse(req.params)
    const body = z.object({ value: z.unknown() }).parse(req.body)
    return versioned(reply, await settings.update(actorOf(req), key, body.value, ifMatch(req), reqInfo(req)))
  })

  // =========================================================================
  // AUDIT LOGS
  // =========================================================================

  app.get('/audit-logs', { preHandler: app.authorize('audit:read') }, async (req) => {
    const f = z.object({
      actorUserId: uuid.optional(),
      actorRole: z.string().optional(),
      action: z.string().optional(),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      institutionId: uuid.optional(),
      employerId: uuid.optional(),
      outcome: z.enum(['success', 'failure', 'denied']).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }).parse(req.query)
    return audit.list(actorOf(req), f, parseSort(q(req).sort, auditSort, { key: 'occurred_at', dir: 'DESC' }), parsePageParams(q(req)))
  })
}
