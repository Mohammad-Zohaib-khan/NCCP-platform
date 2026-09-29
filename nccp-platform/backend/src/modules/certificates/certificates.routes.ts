import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import { parsePageParams } from '../../lib/pagination.js'
import { parseSort } from '../../lib/list-query.js'
import { actorOf, limit, reqInfo, versioned } from '../../lib/http.js'
import { REVOKE_REASON_MAX } from './certificates.rules.js'
import type { CertificatesService } from './certificates.service.js'

const uuid = z.string().uuid()
const q = (req: { query: unknown }) => req.query as Record<string, unknown>
const certificateSort = {
  issued_at: { expr: 'c.issued_at', type: 'timestamptz' as const },
  certificate_no: { expr: 'c.certificate_no', type: 'text' as const },
  holder: { expr: 'lower(c.holder_name)', type: 'text' as const },
  created_at: { expr: 'c.created_at', type: 'timestamptz' as const },
}

export interface CertificateRouteDeps { config: AppConfig; service: CertificatesService }

export async function certificateRoutes(app: FastifyInstance, { config, service }: CertificateRouteDeps): Promise<void> {
  const idParam = z.object({ id: uuid })

  // ---------------- authenticated ----------------
  app.get('/certificates', { preHandler: app.authorize('certificates:read') }, async (req) => {
    const f = z.object({
      traineeId: uuid.optional(), enrolmentId: uuid.optional(), programmeId: uuid.optional(), institutionId: uuid.optional(),
      status: z.enum(['issued', 'revoked']).optional(), q: z.string().trim().max(100).optional(),
    }).parse(req.query)
    return service.list(actorOf(req), f, parseSort(q(req).sort, certificateSort, { key: 'issued_at', dir: 'DESC' }), parsePageParams(q(req)))
  })

  // Registered before /certificates/:id; find-my-way prefers the static segment, and 'eligibility' is not a uuid anyway.
  app.get('/certificates/eligibility/:enrolmentId', { preHandler: app.authorize('certificates:read') }, async (req) => {
    const { enrolmentId } = z.object({ enrolmentId: uuid }).parse(req.params)
    return service.eligibility(actorOf(req), enrolmentId)
  })

  app.get('/certificates/:id', { preHandler: app.authorize('certificates:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return versioned(reply, await service.get(actorOf(req), id))
  })

  // Streams the PDF. Same scope as GET /certificates/:id (out of scope -> 404). private + no-store: it carries a live verification code.
  app.get('/certificates/:id/pdf', { config: limit(config, 30), preHandler: app.authorize('certificates:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const { filename, bytes } = await service.pdf(actorOf(req), id)
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'private, no-store').header('content-length', bytes.length).send(bytes)
  })

  app.post('/certificates', { config: limit(config, 60), preHandler: app.authorize('certificates:issue') }, async (req, reply) => {
    const body = z.object({ enrolmentId: uuid }).strict().parse(req.body)
    return reply.status(201).send(versioned(reply, await service.issue(actorOf(req), body, reqInfo(req))))
  })

  app.post('/certificates/:id/revoke', { config: limit(config, 30), preHandler: app.authorize('certificates:revoke') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ reason: z.string().trim().min(3, 'A reason is required').max(REVOKE_REASON_MAX) }).strict().parse(req.body)
    return versioned(reply, await service.revoke(actorOf(req), id, body, reqInfo(req)))
  })

  // ---------------- public ----------------
  // Unauthenticated and tightly throttled per IP (20 / minute). Unknown, malformed and never-issued codes all return the same 404.
  app.get('/verify/:code', { config: limit(config, 20) }, async (req, reply) => {
    const { code } = z.object({ code: z.string().max(64) }).parse(req.params)
    const result = await service.verifyPublic(code)
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
    return result
  })
}
