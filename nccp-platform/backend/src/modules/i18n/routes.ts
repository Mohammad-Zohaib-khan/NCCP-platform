import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import type { Db } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { writeAudit } from '../../audit/audit.js'
import { actorOf, limit, reqInfo } from '../../lib/http.js'
import { assertEnabledLanguage, LANGUAGE_RE } from '../../lib/i18n.js'

/** Languages and the caller's saved preference. The backend is the source of truth; the frontend may cache it (Part 9). */
export async function i18nRoutes(app: FastifyInstance, { db, config }: { db: Db; config: AppConfig }): Promise<void> {
  app.get('/i18n/languages', { preHandler: app.authorize('profile:read_own') }, async (req) => {
    const r = await db.query(`SELECT preferred_language FROM users WHERE id = $1`, [actorOf(req).userId])
    const saved = (r.rows[0] as { preferred_language: string } | undefined)?.preferred_language ?? config.i18n.defaultLanguage
    return { defaultLanguage: config.i18n.defaultLanguage, enabledLanguages: config.i18n.enabledLanguages, preferredLanguage: config.i18n.enabledLanguages.includes(saved) ? saved : config.i18n.defaultLanguage }
  })
  app.put('/me/language', { config: limit(config, 30), preHandler: app.authorize('profile:write_own') }, async (req) => {
    const actor = actorOf(req)
    const body = z.object({ language: z.string().regex(LANGUAGE_RE) }).strict().parse(req.body)
    assertEnabledLanguage(config.i18n, body.language, 'language')
    await withTransaction(db, async (tx) => {
      await tx.query(`UPDATE users SET preferred_language = $2 WHERE id = $1`, [actor.userId, body.language])
      const info = reqInfo(req)
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, action: 'user.language', entityType: 'user', entityId: actor.userId, changes: { language: body.language } })
    })
    return { preferredLanguage: body.language }
  })
}
