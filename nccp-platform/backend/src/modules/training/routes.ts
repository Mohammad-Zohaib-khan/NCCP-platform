import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import { parsePageParams } from '../../lib/pagination.js'
import { isIsoDate, parseSort } from '../../lib/list-query.js'
import { actorOf, ifMatch, limit, reqInfo, versioned } from '../../lib/http.js'
import type { ProgrammesService } from './programmes.service.js'
import type { BatchesService } from './batches.service.js'

const uuid = z.string().uuid()
const text = (max: number) => z.string().trim().max(max)
const isoDate = z.string().refine(isIsoDate, 'Use a valid date (YYYY-MM-DD)')
const nonEmpty = (p: Record<string, unknown>) => Object.values(p).some((v) => v !== undefined)
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,29}$/, 'Code: 2-30 letters, digits or dashes')

const programmeSort = { created_at: { expr: 'p.created_at', type: 'timestamptz' as const }, title: { expr: 'lower(p.title)', type: 'text' as const } }
const batchSort = { start_date: { expr: 'b.start_date', type: 'date' as const }, code: { expr: 'b.code', type: 'text' as const }, created_at: { expr: 'b.created_at', type: 'timestamptz' as const } }
const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true')

export interface TrainingRouteDeps { config: AppConfig; programmes: ProgrammesService; batches: BatchesService }

export async function trainingRoutes(app: FastifyInstance, { config, programmes, batches }: TrainingRouteDeps): Promise<void> {
  // ---------------- programmes ----------------
  const programmeFields = { code: code.nullable().optional(), title: text(200).min(3), description: text(4000).nullable().optional(), category: text(80).nullable().optional(), durationWeeks: z.number().int().min(1).max(520).nullable().optional(), eligibility: text(1000).nullable().optional() }

  app.get('/programmes', { preHandler: app.authorize('programmes:read') }, async (req) => {
    const q = z.object({ q: text(100).optional(), status: z.enum(['draft', 'pending_approval', 'active', 'archived', 'rejected']).optional(), category: text(80).optional(), institutionId: uuid.optional(), national: boolQuery.optional() }).parse(req.query)
    const sort = parseSort((req.query as Record<string, unknown>).sort, programmeSort, { key: 'created_at', dir: 'DESC' })
    return programmes.list(actorOf(req), q, sort, parsePageParams(req.query as Record<string, unknown>))
  })
  app.post('/programmes', { config: limit(config, 60), preHandler: app.authorize('programmes:write') }, async (req, reply) => {
    const body = z.object({ ...programmeFields, institutionId: uuid.nullable().optional() }).strict().parse(req.body)
    return reply.status(201).send(versioned(reply, await programmes.create(actorOf(req), body, reqInfo(req))))
  })
  app.get('/programmes/:id', { preHandler: app.authorize('programmes:read') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    return versioned(reply, await programmes.get(actorOf(req), id))
  })
  app.patch('/programmes/:id', { preHandler: app.authorize('programmes:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const patch = z.object({ ...programmeFields, title: programmeFields.title.optional() }).strict().refine(nonEmpty, 'Provide at least one field').parse(req.body)
    return versioned(reply, await programmes.update(actorOf(req), id, patch, ifMatch(req), reqInfo(req)))
  })
  app.post('/programmes/:id/status', { config: limit(config, 60), preHandler: app.authorize('programmes:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const body = z.object({ action: z.enum(['submit', 'approve', 'reject', 'archive']), reason: text(500).optional() }).strict().parse(req.body)
    return versioned(reply, await programmes.transition(actorOf(req), id, body.action, body.reason, reqInfo(req)))
  })
  app.delete('/programmes/:id', { preHandler: app.authorize('programmes:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    await programmes.remove(actorOf(req), id, reqInfo(req))
    return reply.status(204).send()
  })

  // ---------------- batches ----------------
  const mode = z.enum(['offline', 'online', 'hybrid'])
  app.get('/batches', { preHandler: app.authorize('batches:read') }, async (req) => {
    const q = z.object({ q: text(100).optional(), status: z.enum(['planned', 'ongoing', 'completed', 'cancelled']).optional(), programmeId: uuid.optional(), trainerId: uuid.optional(), mode: mode.optional(), institutionId: uuid.optional(), startFrom: isoDate.optional(), startTo: isoDate.optional() }).parse(req.query)
    const sort = parseSort((req.query as Record<string, unknown>).sort, batchSort, { key: 'start_date', dir: 'DESC' })
    return batches.list(actorOf(req), q, sort, parsePageParams(req.query as Record<string, unknown>))
  })
  app.post('/batches', { config: limit(config, 60), preHandler: app.authorize('batches:write') }, async (req, reply) => {
    const body = z.object({ code, programmeId: uuid, institutionId: uuid.optional(), trainerId: uuid.nullable().optional(), startDate: isoDate, endDate: isoDate, capacity: z.number().int().min(1).max(10000), schedule: text(200).nullable().optional(), mode: mode.optional() }).strict().parse(req.body)
    return reply.status(201).send(versioned(reply, await batches.create(actorOf(req), body, reqInfo(req))))
  })
  app.get('/batches/:id', { preHandler: app.authorize('batches:read') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    return versioned(reply, await batches.get(actorOf(req), id))
  })
  app.patch('/batches/:id', { preHandler: app.authorize('batches:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const patch = z.object({ code: code.optional(), startDate: isoDate.optional(), endDate: isoDate.optional(), capacity: z.number().int().min(1).max(10000).optional(), schedule: text(200).nullable().optional(), mode: mode.optional() }).strict().refine(nonEmpty, 'Provide at least one field').parse(req.body)
    return versioned(reply, await batches.update(actorOf(req), id, patch, ifMatch(req), reqInfo(req)))
  })
  app.post('/batches/:id/status', { config: limit(config, 60), preHandler: app.authorize('batches:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const body = z.object({ status: z.enum(['ongoing', 'completed', 'cancelled']) }).strict().parse(req.body)
    return versioned(reply, await batches.transition(actorOf(req), id, body.status, reqInfo(req)))
  })
  app.put('/batches/:id/trainer', { preHandler: app.authorize('batches:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const body = z.object({ trainerId: uuid.nullable() }).strict().parse(req.body)
    return versioned(reply, await batches.setTrainer(actorOf(req), id, body.trainerId, reqInfo(req)))
  })
  app.delete('/batches/:id', { preHandler: app.authorize('batches:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    await batches.remove(actorOf(req), id, reqInfo(req))
    return reply.status(204).send()
  })
}
