import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import { parsePageParams } from '../../lib/pagination.js'
import { parseSort } from '../../lib/list-query.js'
import { actorOf, ifMatch, limit, reqInfo, versioned } from '../../lib/http.js'
import type { EmployersService } from './employers.service.js'
import type { JobsService } from './jobs.service.js'
import type { ApplicationsService } from './applications.service.js'
import type { InterviewsService } from './interviews.service.js'
import type { PlacementsService } from './placements.service.js'
import type { CandidatesService } from './candidates.service.js'
import {
  EMPLOYER_ACTIONS, JOB_ACTIONS, APPLICATION_ACTIONS,
  type EmployerAction, type JobAction, type ApplicationAction,
  type InterviewMode, type InterviewStatus, type PlacementStatus,
} from './employment.rules.js'

const uuid = z.string().uuid()
const q = (req: { query: unknown }) => req.query as Record<string, unknown>

const employerSort = {
  created_at: { expr: 'e.created_at', type: 'timestamptz' as const },
  name: { expr: 'lower(e.name)', type: 'text' as const },
  verification_status: { expr: 'e.verification_status', type: 'text' as const },
}

const jobSort = {
  created_at: { expr: 'j.created_at', type: 'timestamptz' as const },
  published_at: { expr: 'j.published_at', type: 'timestamptz' as const },
  title: { expr: 'lower(j.title)', type: 'text' as const },
}

const applicationSort = {
  applied_at: { expr: 'a.applied_at', type: 'timestamptz' as const },
  match_score: { expr: 'a.match_score', type: 'integer' as const },
}

const candidateSort = {
  trainee_id: { expr: 't.id', type: 'text' as const },
  full_name: { expr: 'lower(u.full_name)', type: 'text' as const },
}

const interviewSort = {
  scheduled_at: { expr: 'i.scheduled_at', type: 'timestamptz' as const },
  created_at: { expr: 'i.created_at', type: 'timestamptz' as const },
}

const placementSort = {
  created_at: { expr: 'p.created_at', type: 'timestamptz' as const },
  joining_date: { expr: 'p.joining_date', type: 'date' as const },
}

export interface EmploymentRouteDeps {
  config: AppConfig
  employers: EmployersService
  jobs: JobsService
  applications: ApplicationsService
  interviews: InterviewsService
  placements: PlacementsService
  candidates: CandidatesService
}

export async function employmentRoutes(app: FastifyInstance, deps: EmploymentRouteDeps): Promise<void> {
  const { config, employers, jobs, applications, interviews, placements, candidates } = deps
  const idParam = z.object({ id: uuid })

  // =========================================================================
  // EMPLOYERS
  // =========================================================================

  // Public employer registration (tightly rate limited, 202 response)
  app.post('/employers/apply', { config: limit(config, 10) }, async (req, reply) => {
    const body = z.object({
      name: z.string().trim().min(2).max(200),
      sector: z.string().trim().max(100).optional(),
      location: z.string().trim().max(200).optional(),
      website: z.string().trim().url().max(300).optional().nullable(),
      about: z.string().trim().max(2000).optional(),
      registrationNo: z.string().trim().max(100).optional(),
      contactName: z.string().trim().max(200).optional(),
      contactEmail: z.string().trim().email().max(255).optional(),
      contactPhone: z.string().trim().max(30).optional(),
    }).parse(req.body)

    await employers.applyPublic(body, reqInfo(req))
    return reply.status(202).send({ message: 'Registration received for review' })
  })

  app.get('/employers', { preHandler: app.authorize('employers:read') }, async (req) => {
    const f = z.object({
      q: z.string().trim().max(100).optional(),
      verificationStatus: z.enum(['unverified', 'pending', 'verified', 'rejected', 'suspended']).optional(),
    }).parse(req.query)
    return employers.list(actorOf(req), f, parseSort(q(req).sort, employerSort, { key: 'created_at', dir: 'DESC' }), parsePageParams(q(req)))
  })

  app.get('/employers/:id', { preHandler: app.authorize('employers:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return versioned(reply, await employers.get(actorOf(req), id))
  })

  app.post('/employers', { config: limit(config, 60), preHandler: app.authorize('employers:write') }, async (req, reply) => {
    const body = z.object({
      name: z.string().trim().min(2).max(200),
      sector: z.string().trim().max(100).optional(),
      location: z.string().trim().max(200).optional(),
      website: z.string().trim().url().max(300).optional().nullable(),
      about: z.string().trim().max(2000).optional(),
      registrationNo: z.string().trim().max(100).optional(),
      contactName: z.string().trim().max(200).optional(),
      contactEmail: z.string().trim().email().max(255).optional(),
      contactPhone: z.string().trim().max(30).optional(),
    }).parse(req.body)
    return reply.status(201).send(versioned(reply, await employers.create(actorOf(req), body, reqInfo(req))))
  })

  app.patch('/employers/:id', { preHandler: app.authorize('employers:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({
      name: z.string().trim().min(2).max(200).optional(),
      sector: z.string().trim().max(100).optional().nullable(),
      location: z.string().trim().max(200).optional().nullable(),
      website: z.string().trim().url().max(300).optional().nullable(),
      about: z.string().trim().max(2000).optional().nullable(),
      registrationNo: z.string().trim().max(100).optional().nullable(),
      contactName: z.string().trim().max(200).optional().nullable(),
      contactEmail: z.string().trim().email().max(255).optional().nullable(),
      contactPhone: z.string().trim().max(30).optional().nullable(),
    }).parse(req.body)
    return versioned(reply, await employers.update(actorOf(req), id, body, ifMatch(req), reqInfo(req)))
  })

  app.post('/employers/:id/verify', { preHandler: app.authorize('employers:verify') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({
      action: z.enum(EMPLOYER_ACTIONS as unknown as [string, ...string[]]),
      reason: z.string().trim().max(1000).optional(),
    }).parse(req.body)
    return versioned(reply, await employers.transition(actorOf(req), id, body.action as EmployerAction, body.reason, reqInfo(req)))
  })

  app.get('/employers/:id/members', { preHandler: app.authorize('employers:read') }, async (req) => {
    const { id } = idParam.parse(req.params)
    return employers.listMembers(actorOf(req), id)
  })

  app.post('/employers/:id/members', { preHandler: app.authorize('employers:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({
      userId: uuid,
      orgRole: z.string().trim().min(2).max(50).default('member'),
    }).parse(req.body)
    await employers.addMember(actorOf(req), id, body.userId, body.orgRole, reqInfo(req))
    return reply.status(201).send({ ok: true })
  })

  app.delete('/employers/:id/members/:userId', { preHandler: app.authorize('employers:write') }, async (req, reply) => {
    const { id, userId } = z.object({ id: uuid, userId: uuid }).parse(req.params)
    await employers.removeMember(actorOf(req), id, userId, reqInfo(req))
    return reply.status(204).send()
  })

  // =========================================================================
  // JOBS
  // =========================================================================

  app.get('/jobs', { preHandler: app.authorize('jobs:read') }, async (req) => {
    const f = z.object({
      employerId: uuid.optional(),
      status: z.enum(['draft', 'active', 'paused', 'closed']).optional(),
      employmentType: z.string().trim().max(50).optional(),
      workMode: z.string().trim().max(50).optional(),
      location: z.string().trim().max(100).optional(),
      q: z.string().trim().max(100).optional(),
    }).parse(req.query)
    return jobs.list(actorOf(req), f, parseSort(q(req).sort, jobSort, { key: 'created_at', dir: 'DESC' }), parsePageParams(q(req)))
  })

  app.get('/jobs/:id', { preHandler: app.authorize('jobs:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return versioned(reply, await jobs.get(actorOf(req), id))
  })

  app.post('/jobs', { config: limit(config, 60), preHandler: app.authorize('jobs:write') }, async (req, reply) => {
    const body = z.object({
      employerId: uuid,
      title: z.string().trim().min(3).max(200),
      employmentType: z.string().trim().max(50).optional(),
      openings: z.number().int().min(1).max(1000).optional(),
      location: z.string().trim().max(200).optional().nullable(),
      workMode: z.string().trim().max(50).optional().nullable(),
      experience: z.string().trim().max(100).optional().nullable(),
      salaryText: z.string().trim().max(100).optional().nullable(),
      salaryMin: z.number().min(0).optional().nullable(),
      salaryMax: z.number().min(0).optional().nullable(),
      description: z.string().trim().max(10000).optional().nullable(),
      requiredSkills: z.string().trim().max(1000).optional().nullable(),
      preferredSkills: z.string().trim().max(1000).optional().nullable(),
      qualification: z.string().trim().max(200).optional().nullable(),
      benefits: z.string().trim().max(2000).optional().nullable(),
      deadline: z.string().trim().max(10).optional().nullable(),
    }).parse(req.body)
    return reply.status(201).send(versioned(reply, await jobs.create(actorOf(req), body, reqInfo(req))))
  })

  app.patch('/jobs/:id', { preHandler: app.authorize('jobs:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({
      title: z.string().trim().min(3).max(200).optional(),
      employmentType: z.string().trim().max(50).optional(),
      openings: z.number().int().min(1).max(1000).optional(),
      location: z.string().trim().max(200).optional().nullable(),
      workMode: z.string().trim().max(50).optional().nullable(),
      experience: z.string().trim().max(100).optional().nullable(),
      salaryText: z.string().trim().max(100).optional().nullable(),
      salaryMin: z.number().min(0).optional().nullable(),
      salaryMax: z.number().min(0).optional().nullable(),
      description: z.string().trim().max(10000).optional().nullable(),
      requiredSkills: z.string().trim().max(1000).optional().nullable(),
      preferredSkills: z.string().trim().max(1000).optional().nullable(),
      qualification: z.string().trim().max(200).optional().nullable(),
      benefits: z.string().trim().max(2000).optional().nullable(),
      deadline: z.string().trim().max(10).optional().nullable(),
    }).parse(req.body)
    return versioned(reply, await jobs.update(actorOf(req), id, body, ifMatch(req), reqInfo(req)))
  })

  for (const action of JOB_ACTIONS) {
    app.post(`/jobs/:id/${action}`, { preHandler: app.authorize('jobs:write') }, async (req, reply) => {
      const { id } = idParam.parse(req.params)
      return versioned(reply, await jobs.transition(actorOf(req), id, action as JobAction, ifMatch(req), reqInfo(req)))
    })
  }

  // =========================================================================
  // APPLICATIONS
  // =========================================================================

  app.post('/jobs/:jobId/apply', { config: limit(config, 30), preHandler: app.authorize('applications:apply_own') }, async (req, reply) => {
    const { jobId } = z.object({ jobId: uuid }).parse(req.params)
    const body = z.object({
      coverNote: z.string().trim().max(2000).optional(),
      resumeFileId: uuid.optional(),
    }).parse(req.body ?? {})
    return reply.status(201).send(versioned(reply, await applications.apply(actorOf(req), { jobId, ...body }, reqInfo(req))))
  })

  app.get('/applications', { preHandler: app.authorize('applications:read') }, async (req) => {
    const f = z.object({
      jobId: uuid.optional(),
      traineeId: uuid.optional(),
      status: z.enum(['review', 'shortlisted', 'interview', 'offer', 'placed', 'rejected', 'withdrawn']).optional(),
    }).parse(req.query)
    return applications.list(actorOf(req), f, parseSort(q(req).sort, applicationSort, { key: 'applied_at', dir: 'DESC' }), parsePageParams(q(req)))
  })

  app.get('/applications/:id', { preHandler: app.authorize('applications:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return versioned(reply, await applications.get(actorOf(req), id))
  })

  app.post('/applications/:id/shortlist', { preHandler: app.authorize('applications:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {})
    return versioned(reply, await applications.transition(actorOf(req), id, 'shortlist', body.note, ifMatch(req), reqInfo(req)))
  })

  app.post('/applications/:id/interview', { preHandler: app.authorize('applications:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {})
    return versioned(reply, await applications.transition(actorOf(req), id, 'interview', body.note, ifMatch(req), reqInfo(req)))
  })

  app.post('/applications/:id/offer', { preHandler: app.authorize('applications:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {})
    return versioned(reply, await applications.transition(actorOf(req), id, 'offer', body.note, ifMatch(req), reqInfo(req)))
  })

  app.post('/applications/:id/reject', { preHandler: app.authorize('applications:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ note: z.string().trim().min(3, 'A reason is required to reject an application').max(500) }).parse(req.body)
    return versioned(reply, await applications.transition(actorOf(req), id, 'reject', body.note, ifMatch(req), reqInfo(req)))
  })

  app.post('/applications/:id/withdraw', { preHandler: app.authorize('applications:apply_own') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {})
    return versioned(reply, await applications.transition(actorOf(req), id, 'withdraw', body.note, ifMatch(req), reqInfo(req)))
  })

  app.patch('/applications/:id/notes', { preHandler: app.authorize('applications:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ employerNotes: z.string().trim().max(2000) }).parse(req.body)
    return versioned(reply, await applications.updateNotes(actorOf(req), id, body.employerNotes, ifMatch(req), reqInfo(req)))
  })

  // =========================================================================
  // INTERVIEWS
  // =========================================================================

  app.post('/interviews', { config: limit(config, 60), preHandler: app.authorize('interviews:write') }, async (req, reply) => {
    const body = z.object({
      applicationId: uuid,
      scheduledAt: z.string().datetime(),
      mode: z.enum(['video', 'phone', 'in_person']),
      locationOrLink: z.string().trim().max(500).optional().nullable(),
      notes: z.string().trim().max(2000).optional().nullable(),
    }).parse(req.body)
    return reply.status(201).send(versioned(reply, await interviews.schedule(actorOf(req), body, reqInfo(req))))
  })

  app.get('/interviews', { preHandler: app.authorize('applications:read') }, async (req) => {
    const f = z.object({
      applicationId: uuid.optional(),
      status: z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
    }).parse(req.query)
    return interviews.list(actorOf(req), f, parseSort(q(req).sort, interviewSort, { key: 'scheduled_at', dir: 'ASC' }), parsePageParams(q(req)))
  })

  app.get('/interviews/:id', { preHandler: app.authorize('applications:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return versioned(reply, await interviews.get(actorOf(req), id))
  })

  app.patch('/interviews/:id/status', { preHandler: app.authorize('interviews:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({
      status: z.enum(['confirmed', 'completed', 'cancelled', 'no_show']),
      outcomeNotes: z.string().trim().max(2000).optional(),
    }).parse(req.body)
    return versioned(reply, await interviews.updateStatus(actorOf(req), id, body.status as InterviewStatus, body.outcomeNotes, ifMatch(req), reqInfo(req)))
  })

  // =========================================================================
  // PLACEMENTS
  // =========================================================================

  app.post('/placements', { config: limit(config, 60), preHandler: app.authorize('placements:write') }, async (req, reply) => {
    const body = z.object({
      applicationId: uuid,
      joiningDate: z.string().trim().max(10).optional().nullable(),
      salaryOffered: z.number().min(0).optional().nullable(),
    }).parse(req.body)
    return reply.status(201).send(versioned(reply, await placements.record(actorOf(req), body, reqInfo(req))))
  })

  app.get('/placements', { preHandler: app.authorize('placements:read') }, async (req) => {
    const f = z.object({
      employerId: uuid.optional(),
      jobId: uuid.optional(),
      traineeId: uuid.optional(),
      status: z.enum(['confirmed', 'joined', 'not_joined', 'left']).optional(),
    }).parse(req.query)
    return placements.list(actorOf(req), f, parseSort(q(req).sort, placementSort, { key: 'created_at', dir: 'DESC' }), parsePageParams(q(req)))
  })

  app.get('/placements/:id', { preHandler: app.authorize('placements:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return versioned(reply, await placements.get(actorOf(req), id))
  })

  app.patch('/placements/:id/status', { preHandler: app.authorize('placements:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({
      status: z.enum(['joined', 'not_joined', 'left']),
    }).parse(req.body)
    return versioned(reply, await placements.transitionStatus(actorOf(req), id, body.status as PlacementStatus, ifMatch(req), reqInfo(req)))
  })

  // =========================================================================
  // CANDIDATES (TALENT POOL)
  // =========================================================================

  app.get('/candidates', { preHandler: app.authorize('candidates:search') }, async (req) => {
    const f = z.object({
      skills: z.string().trim().max(200).optional(),
      location: z.string().trim().max(100).optional(),
      state: z.string().trim().max(100).optional(),
      district: z.string().trim().max(100).optional(),
      hasCertificate: z.coerce.boolean().optional(),
      q: z.string().trim().max(100).optional(),
    }).parse(req.query)
    return candidates.search(actorOf(req), f, parseSort(q(req).sort, candidateSort, { key: 'trainee_id', dir: 'ASC' }), parsePageParams(q(req)))
  })
}
