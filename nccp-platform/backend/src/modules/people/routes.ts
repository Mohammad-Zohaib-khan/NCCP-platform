import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { parsePageParams } from '../../lib/pagination.js'
import { isIsoDate, parseSort } from '../../lib/list-query.js'
import { actorOf, ifMatch, limit, reqInfo, versioned } from '../../lib/http.js'
import type { TrainersService } from './trainers.service.js'
import type { TraineesService } from './trainees.service.js'

const uuid = z.string().uuid()
const email = z.string().trim().toLowerCase().email().max(254)
const phone = z.string().trim().regex(/^[0-9+()\-\s]{6,20}$/, 'Enter a valid phone number')
const text = (max: number) => z.string().trim().max(max)
const tags = (maxItems: number, maxLen: number) => z.array(z.string().trim().min(1).max(maxLen)).max(maxItems)
  .transform((a) => [...new Map(a.map((s) => [s.toLowerCase(), s])).values()]) // de-duplicate case-insensitively, keep first spelling
const jsonObject = (maxBytes: number) => z.record(z.unknown()).refine((o) => JSON.stringify(o).length <= maxBytes, `Must be at most ${maxBytes} bytes of JSON`)
const isoDate = z.string().refine(isIsoDate, 'Use YYYY-MM-DD').refine((d) => d <= new Date().toISOString().slice(0, 10), 'Date cannot be in the future').refine((d) => d >= '1900-01-01', 'Date is too early')
const nonEmpty = (p: Record<string, unknown>) => Object.values(p).some((v) => v !== undefined)

const trainerSort = { created_at: { expr: 't.created_at', type: 'timestamptz' as const }, name: { expr: 'lower(u.full_name)', type: 'text' as const }, experience: { expr: 'COALESCE(t.experience_years, 0)', type: 'integer' as const } }
const traineeSort = { created_at: { expr: 't.created_at', type: 'timestamptz' as const }, name: { expr: 'lower(u.full_name)', type: 'text' as const } }
const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true')

export interface PeopleRouteDeps { config: AppConfig; trainers: TrainersService; trainees: TraineesService }

export async function peopleRoutes(app: FastifyInstance, { config, trainers, trainees }: PeopleRouteDeps): Promise<void> {
  // ---------------- trainers ----------------
  const trainerCreate = z.object({ email, fullName: text(120).min(2), phone: phone.optional(), institutionId: uuid.optional(), designation: text(100).optional(), qualifications: text(500).optional(), expertise: tags(30, 60).optional(), experienceYears: z.number().int().min(0).max(70).optional(), availability: jsonObject(4000).optional() }).strict()
  const trainerPatch = z.object({ fullName: text(120).min(2).optional(), phone: phone.nullable().optional(), designation: text(100).nullable().optional(), qualifications: text(500).nullable().optional(), expertise: tags(30, 60).optional(), experienceYears: z.number().int().min(0).max(70).nullable().optional(), availability: jsonObject(4000).optional(), status: z.enum(['active', 'inactive', 'on_leave']).optional() }).strict().refine(nonEmpty, 'Provide at least one field')
  const trainerSelfPatch = z.object({ availability: jsonObject(4000).optional(), expertise: tags(30, 60).optional(), qualifications: text(500).nullable().optional() }).strict().refine(nonEmpty, 'Provide at least one field')

  app.get('/trainers', { preHandler: app.authorize('trainers:read') }, async (req) => {
    const q = z.object({ q: text(100).optional(), status: z.enum(['active', 'inactive', 'on_leave']).optional(), institutionId: uuid.optional(), expertise: text(60).optional() }).parse(req.query)
    const sort = parseSort((req.query as Record<string, unknown>).sort, trainerSort, { key: 'created_at', dir: 'DESC' })
    return trainers.list(actorOf(req), q, sort, parsePageParams(req.query as Record<string, unknown>))
  })
  app.post('/trainers', { config: limit(config, 30), preHandler: app.authorize('trainers:write') }, async (req, reply) => {
    const out = await trainers.create(actorOf(req), trainerCreate.parse(req.body), reqInfo(req))
    reply.header('etag', `"${out.trainer.version}"`)
    return reply.status(201).send(out)
  })
  // /me routes are declared before /:id so 'me' is never parsed as an id.
  app.get('/trainers/me', { preHandler: app.authorize('profile:read_own') }, async (req, reply) => {
    if (actorOf(req).role !== 'trainer') throw AppError.notFound('Trainer profile')
    return versioned(reply, await trainers.getOwn(actorOf(req)))
  })
  app.patch('/trainers/me', { preHandler: app.authorize('profile:write_own') }, async (req, reply) => {
    if (actorOf(req).role !== 'trainer') throw AppError.notFound('Trainer profile')
    return versioned(reply, await trainers.updateOwn(actorOf(req), trainerSelfPatch.parse(req.body), ifMatch(req), reqInfo(req)))
  })
  app.get('/trainers/:id', { preHandler: app.authorize('trainers:read') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    return versioned(reply, await trainers.get(actorOf(req), id))
  })
  app.patch('/trainers/:id', { preHandler: app.authorize('trainers:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    return versioned(reply, await trainers.update(actorOf(req), id, trainerPatch.parse(req.body), ifMatch(req), reqInfo(req)))
  })
  app.delete('/trainers/:id', { preHandler: app.authorize('trainers:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    await trainers.remove(actorOf(req), id, reqInfo(req))
    return reply.status(204).send()
  })

  // ---------------- trainees ----------------
  const profile = { gender: z.enum(['female', 'male', 'other', 'undisclosed']), dateOfBirth: isoDate, state: text(60), district: text(60), location: text(120), education: text(120), skills: tags(50, 60), careerProfile: jsonObject(8000), openToWork: z.boolean() }
  const traineeCreate = z.object({ email, fullName: text(120).min(2), phone: phone.optional(), institutionId: uuid.optional(),
    gender: profile.gender.optional(), dateOfBirth: profile.dateOfBirth.optional(), state: profile.state.optional(), district: profile.district.optional(), location: profile.location.optional(),
    education: profile.education.optional(), skills: profile.skills.optional(), careerProfile: profile.careerProfile.optional(), openToWork: profile.openToWork.optional() }).strict()
  const traineePatch = z.object({ fullName: text(120).min(2).optional(), phone: phone.nullable().optional(), status: z.enum(['active', 'inactive', 'graduated', 'dropped']).optional(),
    gender: profile.gender.nullable().optional(), dateOfBirth: profile.dateOfBirth.nullable().optional(), state: profile.state.nullable().optional(), district: profile.district.nullable().optional(),
    location: profile.location.nullable().optional(), education: profile.education.nullable().optional(), skills: profile.skills.optional(), careerProfile: profile.careerProfile.optional(), openToWork: profile.openToWork.optional() }).strict().refine(nonEmpty, 'Provide at least one field')
  const traineeSelfPatch = z.object({ skills: profile.skills.optional(), careerProfile: profile.careerProfile.optional(), openToWork: profile.openToWork.optional(), location: profile.location.nullable().optional(), education: profile.education.nullable().optional() }).strict().refine(nonEmpty, 'Provide at least one field')

  app.get('/trainees', { preHandler: app.authorize('trainees:read') }, async (req) => {
    const q = z.object({ q: text(100).optional(), status: z.enum(['active', 'inactive', 'graduated', 'dropped']).optional(), institutionId: uuid.optional(), state: text(60).optional(), skill: text(60).optional(), openToWork: boolQuery.optional() }).parse(req.query)
    const sort = parseSort((req.query as Record<string, unknown>).sort, traineeSort, { key: 'created_at', dir: 'DESC' })
    return trainees.list(actorOf(req), q, sort, parsePageParams(req.query as Record<string, unknown>))
  })
  app.post('/trainees', { config: limit(config, 60), preHandler: app.authorize('trainees:write') }, async (req, reply) => {
    const out = await trainees.create(actorOf(req), traineeCreate.parse(req.body), reqInfo(req))
    reply.header('etag', `"${out.trainee.version}"`)
    return reply.status(201).send(out)
  })
  app.get('/trainees/me', { preHandler: app.authorize('profile:read_own') }, async (req, reply) => {
    if (actorOf(req).role !== 'trainee') throw AppError.notFound('Trainee profile')
    return versioned(reply, await trainees.getOwn(actorOf(req)))
  })
  app.patch('/trainees/me', { preHandler: app.authorize('profile:write_own') }, async (req, reply) => {
    if (actorOf(req).role !== 'trainee') throw AppError.notFound('Trainee profile')
    return versioned(reply, await trainees.updateOwn(actorOf(req), traineeSelfPatch.parse(req.body), ifMatch(req), reqInfo(req)))
  })
  app.get('/trainees/:id', { preHandler: app.authorize('trainees:read') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    return versioned(reply, await trainees.get(actorOf(req), id))
  })
  app.patch('/trainees/:id', { preHandler: app.authorize('trainees:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    return versioned(reply, await trainees.update(actorOf(req), id, traineePatch.parse(req.body), ifMatch(req), reqInfo(req)))
  })
  app.delete('/trainees/:id', { preHandler: app.authorize('trainees:write') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    await trainees.remove(actorOf(req), id, reqInfo(req))
    return reply.status(204).send()
  })
}
