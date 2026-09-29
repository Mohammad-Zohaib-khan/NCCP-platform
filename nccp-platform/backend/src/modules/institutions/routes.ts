import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import { parsePageParams } from '../../lib/pagination.js'
import { parseSort } from '../../lib/list-query.js'
import { actorOf, ifMatch, limit, reqInfo, versioned } from '../../lib/http.js'
import type { InstitutionsService } from './service.js'

const uuid = z.string().uuid()
const opt = (max: number) => z.string().trim().min(1).max(max).nullish().transform((v) => v ?? undefined)
const optNullable = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v))
const emailField = z.string().trim().toLowerCase().email().max(254)
const phone = z.string().trim().regex(/^[0-9+()\-\s]{6,20}$/, 'Enter a valid phone number')
const pincode = z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits')
const website = z.string().trim().url().max(200).refine((u) => /^https?:\/\//i.test(u), 'Website must start with http:// or https://')

const detailFields = {
  institutionType: opt(60), state: opt(60), district: opt(60), address: opt(300), pincode: pincode.nullish().transform((v) => v ?? undefined),
  contactName: opt(120), contactEmail: emailField.nullish().transform((v) => v ?? undefined), contactPhone: phone.nullish().transform((v) => v ?? undefined), website: website.nullish().transform((v) => v ?? undefined),
}
const createBody = z.object({ name: z.string().trim().min(2).max(160), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Code: 2-20 letters, digits or dashes').optional(), ...detailFields }).strict()
const applyBody = z.object({ name: z.string().trim().min(2).max(160), state: z.string().trim().min(2).max(60), contactName: z.string().trim().min(2).max(120), contactEmail: emailField, contactPhone: phone.optional(), institutionType: opt(60), district: opt(60), address: opt(300), pincode: pincode.optional(), website: website.optional() }).strict()
const patchBody = z.object({
  name: z.string().trim().min(2).max(160).optional(), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/).optional(),
  institutionType: optNullable(60), state: optNullable(60), district: optNullable(60), address: optNullable(300),
  pincode: pincode.nullable().optional(), contactName: optNullable(120), contactEmail: emailField.nullable().optional(), contactPhone: phone.nullable().optional(), website: website.nullable().optional(),
}).strict().refine((p) => Object.values(p).some((v) => v !== undefined), 'Provide at least one field')

const SORTS = { created_at: { expr: 'i.created_at', type: 'timestamptz' as const }, name: { expr: 'lower(i.name)', type: 'text' as const }, state: { expr: "COALESCE(i.state, '')", type: 'text' as const } }

export interface InstitutionRouteDeps { config: AppConfig; service: InstitutionsService }

export async function institutionRoutes(app: FastifyInstance, { config, service }: InstitutionRouteDeps): Promise<void> {
  // Public onboarding: throttled per IP. There is no CAPTCHA yet; see docs/part-3-notes.md for the decision.
  app.post('/institutions/apply', { config: limit(config, 5, '1 hour') }, async (req, reply) => {
    const body = applyBody.parse(req.body)
    await service.apply(body, reqInfo(req))
    return reply.status(202).send({ message: 'Thank you. Your application has been received and will be reviewed by NCCP.' })
  })

  app.get('/institutions', { preHandler: app.authorize('institutions:read') }, async (req) => {
    const q = z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['pending', 'active', 'suspended', 'rejected']).optional(), state: z.string().trim().max(60).optional(), institutionType: z.string().trim().max(60).optional() }).parse(req.query)
    const sort = parseSort((req.query as Record<string, unknown>).sort, SORTS, { key: 'created_at', dir: 'DESC' })
    return service.list(actorOf(req), q, sort, parsePageParams(req.query as Record<string, unknown>))
  })

  app.post('/institutions', { config: limit(config, 30), preHandler: app.authorize('institutions:write') }, async (req, reply) => {
    const body = createBody.parse(req.body)
    const created = await service.create(actorOf(req), body, reqInfo(req))
    return reply.status(201).send(versioned(reply, created))
  })

  app.get('/institutions/:id', { preHandler: app.authorize('institutions:read') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    return versioned(reply, await service.get(actorOf(req), id))
  })

  app.patch('/institutions/:id', { preHandler: app.authorize('institutions:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const patch = patchBody.parse(req.body)
    return versioned(reply, await service.update(actorOf(req), id, patch, ifMatch(req), reqInfo(req)))
  })

  app.delete('/institutions/:id', { preHandler: app.authorize('institutions:approve') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    await service.remove(actorOf(req), id, reqInfo(req))
    return reply.status(204).send()
  })

  app.post('/institutions/:id/status', { config: limit(config, 60), preHandler: app.authorize('institutions:approve') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const body = z.object({ action: z.enum(['approve', 'reject', 'suspend', 'reactivate', 'reopen']), reason: z.string().trim().max(500).optional() }).strict().parse(req.body)
    return versioned(reply, await service.transition(actorOf(req), id, body.action, body.reason, reqInfo(req)))
  })

  app.get('/institutions/:id/admins', { preHandler: app.authorize('institutions:read') }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    return service.listAdmins(actorOf(req), id)
  })
  app.post('/institutions/:id/admins', { preHandler: app.authorize('institutions:approve') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const body = z.object({ userId: uuid, orgRole: z.enum(['owner', 'admin']).default('admin') }).strict().parse(req.body)
    return reply.status(201).send(await service.assignAdmin(actorOf(req), id, body.userId, body.orgRole, reqInfo(req)))
  })
  app.delete('/institutions/:id/admins/:userId', { preHandler: app.authorize('institutions:approve') }, async (req, reply) => {
    const { id, userId } = z.object({ id: uuid, userId: uuid }).parse(req.params)
    await service.removeAdmin(actorOf(req), id, userId, reqInfo(req))
    return reply.status(204).send()
  })
}
