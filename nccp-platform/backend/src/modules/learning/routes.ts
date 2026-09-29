import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import type { Db } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import { parsePageParams } from '../../lib/pagination.js'
import { parseSort } from '../../lib/list-query.js'
import { actorOf, ifMatch, limit, reqInfo, versioned } from '../../lib/http.js'
import { requirePermission } from '../../auth/context.js'
import type { EnrolmentsService } from './enrolments.service.js'
import type { LmsService } from './lms.service.js'
import type { SessionsService } from './sessions.service.js'
import type { AttendanceService } from './attendance.service.js'
import type { AssessmentsService } from './assessments.service.js'
import { ATTENDANCE_STATUSES } from './attendance.rules.js'
import { resolveLanguage, LANGUAGE_RE } from '../../lib/i18n.js'
import type { TranslatableKind } from './lms.service.js'

const uuid = z.string().uuid()
const text = (max: number) => z.string().trim().max(max)
const dateTime = z.string().datetime({ offset: true })
const httpUrl = z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links are allowed')
const nonEmpty = (p: Record<string, unknown>) => Object.values(p).some((v) => v !== undefined)
const q = (req: { query: unknown }) => req.query as Record<string, unknown>
const position = z.number().int().min(0).max(100_000)

const enrolmentSort = { enrolled_at: { expr: 'e.enrolled_at', type: 'timestamptz' as const }, trainee: { expr: 'lower(u.full_name)', type: 'text' as const }, created_at: { expr: 'e.created_at', type: 'timestamptz' as const } }
const courseSort = { position: { expr: 'c.position', type: 'integer' as const }, title: { expr: 'lower(c.title)', type: 'text' as const }, created_at: { expr: 'c.created_at', type: 'timestamptz' as const } }
const resourceSort = { created_at: { expr: 'r.created_at', type: 'timestamptz' as const }, title: { expr: 'lower(r.title)', type: 'text' as const } }
const sessionSort = { starts_at: { expr: 's.starts_at', type: 'timestamptz' as const }, created_at: { expr: 's.created_at', type: 'timestamptz' as const } }
const attendanceSort = { created_at: { expr: 'a.created_at', type: 'timestamptz' as const }, starts_at: { expr: 's.starts_at', type: 'timestamptz' as const } }
const assessmentSort = { created_at: { expr: 'a.created_at', type: 'timestamptz' as const }, title: { expr: 'lower(a.title)', type: 'text' as const } }
const resultSort = { created_at: { expr: 'r.created_at', type: 'timestamptz' as const } }

const question = z.discriminatedUnion('type', [
  z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), type: z.literal('mcq'), prompt: text(2000).min(1), marks: z.number().positive().max(1000),
    options: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), text: text(500).min(1) }).strict()).min(2).max(10), correctOptionId: z.string() }).strict(),
  z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), type: z.literal('text'), prompt: text(2000).min(1), marks: z.number().positive().max(1000) }).strict(),
])
const assessmentType = z.enum(['quiz', 'assignment', 'practical', 'final_exam'])

export interface LearningRouteDeps {
  db: Db; config: AppConfig; enrolments: EnrolmentsService; lms: LmsService; sessions: SessionsService; attendance: AttendanceService; assessments: AssessmentsService
}

export async function learningRoutes(app: FastifyInstance, { db, config, enrolments, lms, sessions, attendance, assessments }: LearningRouteDeps): Promise<void> {
  const idParam = z.object({ id: uuid })
  const langQuery = z.object({ lang: z.string().regex(LANGUAGE_RE).optional() })
  /** explicit ?lang > the caller's saved preference > default language (422 if the requested language is not enabled) */
  const langOf = async (req: FastifyRequest) => resolveLanguage(db, config.i18n, actorOf(req).userId, langQuery.parse(req.query).lang)

  // ---------------- enrolments ----------------
  app.get('/enrolments', { preHandler: app.authorize('enrolments:read') }, async (req) => {
    const f = z.object({ batchId: uuid.optional(), traineeId: uuid.optional(), status: z.enum(['applied', 'enrolled', 'in_progress', 'completed', 'dropped', 'rejected']).optional(), q: text(100).optional(), institutionId: uuid.optional() }).parse(req.query)
    return enrolments.list(actorOf(req), f, parseSort(q(req).sort, enrolmentSort, { key: 'enrolled_at', dir: 'DESC' }), parsePageParams(q(req)))
  })
  app.post('/enrolments', { config: limit(config, 120), preHandler: app.authorize('enrolments:write') }, async (req, reply) => {
    const body = z.object({ batchId: uuid, traineeId: uuid }).strict().parse(req.body)
    return reply.status(201).send(versioned(reply, await enrolments.enrol(actorOf(req), body, reqInfo(req))))
  })
  app.post('/enrolments/apply', { config: limit(config, 20), preHandler: app.authorize('enrolments:apply_own') }, async (req, reply) => {
    const body = z.object({ batchId: uuid }).strict().parse(req.body)
    return reply.status(201).send(versioned(reply, await enrolments.apply(actorOf(req), body, reqInfo(req))))
  })
  app.get('/enrolments/:id', { preHandler: app.authorize('enrolments:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return versioned(reply, await enrolments.get(actorOf(req), id))
  })
  app.post('/enrolments/:id/status', { config: limit(config, 120), preHandler: app.authorize('enrolments:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ action: z.enum(['approve', 'reject', 'start', 'complete', 'drop', 'withdraw']), reason: text(500).optional(), finalScore: z.number().min(0).max(100).optional() }).strict().parse(req.body)
    const actor = actorOf(req)
    requirePermission(actor, body.action === 'withdraw' ? 'enrolments:apply_own' : 'enrolments:write')
    if (body.finalScore !== undefined && body.action !== 'complete') throw AppError.validation([{ path: 'finalScore', message: 'finalScore only applies to the complete action' }])
    return versioned(reply, await enrolments.transition(actor, id, body.action, { reason: body.reason, finalScore: body.finalScore }, reqInfo(req)))
  })

  // ---------------- courses / modules / lessons ----------------
  const courseFields = { title: text(200).min(2), description: text(4000).nullable().optional(), position: position.optional(), status: z.enum(['draft', 'published', 'archived']).optional() }
  app.get('/courses', { preHandler: app.authorize('courses:read') }, async (req) => {
    const f = z.object({ programmeId: uuid.optional(), status: z.enum(['draft', 'published', 'archived']).optional(), q: text(100).optional(), lang: z.string().optional() }).parse(req.query)
    return lms.listCourses(actorOf(req), f, parseSort(q(req).sort, courseSort, { key: 'position', dir: 'ASC' }), parsePageParams(q(req)), await langOf(req))
  })
  app.post('/courses', { config: limit(config, 60), preHandler: app.authorize('courses:write') }, async (req, reply) => {
    const body = z.object({ programmeId: uuid, ...courseFields }).strict().parse(req.body)
    return reply.status(201).send(versioned(reply, await lms.createCourse(actorOf(req), body, reqInfo(req))))
  })
  app.get('/courses/:id', { preHandler: app.authorize('courses:read') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return versioned(reply, await lms.getCourse(actorOf(req), id, await langOf(req)))
  })
  app.get('/courses/:id/outline', { preHandler: app.authorize('courses:read') }, async (req) => {
    const { id } = idParam.parse(req.params)
    return lms.outline(actorOf(req), id, await langOf(req))
  })
  app.patch('/courses/:id', { preHandler: app.authorize('courses:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const patch = z.object({ ...courseFields, title: courseFields.title.optional() }).strict().refine(nonEmpty, 'Provide at least one field').parse(req.body)
    return versioned(reply, await lms.updateCourse(actorOf(req), id, patch, ifMatch(req), reqInfo(req)))
  })
  app.delete('/courses/:id', { preHandler: app.authorize('courses:write') }, async (req, reply) => {
    await lms.removeCourse(actorOf(req), idParam.parse(req.params).id, reqInfo(req))
    return reply.status(204).send()
  })

  app.post('/modules', { config: limit(config, 120), preHandler: app.authorize('courses:write') }, async (req, reply) => {
    const body = z.object({ courseId: uuid, title: text(200).min(2), position: position.optional() }).strict().parse(req.body)
    return reply.status(201).send(versioned(reply, await lms.createModule(actorOf(req), body, reqInfo(req))))
  })
  app.patch('/modules/:id', { preHandler: app.authorize('courses:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const patch = z.object({ title: text(200).min(2).optional(), position: position.optional() }).strict().refine(nonEmpty, 'Provide at least one field').parse(req.body)
    return versioned(reply, await lms.updateModule(actorOf(req), id, patch, ifMatch(req), reqInfo(req)))
  })
  app.delete('/modules/:id', { preHandler: app.authorize('courses:write') }, async (req, reply) => {
    await lms.removeModule(actorOf(req), idParam.parse(req.params).id, reqInfo(req))
    return reply.status(204).send()
  })

  const lessonType = z.enum(['video', 'reading', 'document', 'quiz', 'live'])
  const lessonFields = { title: text(200).min(2), lessonType: lessonType.optional(), content: text(50_000).nullable().optional(), durationMin: z.number().int().min(0).max(10_000).nullable().optional(), position: position.optional() }
  app.post('/lessons', { config: limit(config, 240), preHandler: app.authorize('courses:write') }, async (req, reply) => {
    const body = z.object({ moduleId: uuid, ...lessonFields }).strict().parse(req.body)
    return reply.status(201).send(versioned(reply, await lms.createLesson(actorOf(req), body, reqInfo(req))))
  })
  app.get('/lessons/:id', { preHandler: app.authorize('courses:read') }, async (req, reply) => {
    return versioned(reply, await lms.getLesson(actorOf(req), idParam.parse(req.params).id, await langOf(req)))
  })
  app.patch('/lessons/:id', { preHandler: app.authorize('courses:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const patch = z.object({ ...lessonFields, title: lessonFields.title.optional() }).strict().refine(nonEmpty, 'Provide at least one field').parse(req.body)
    return versioned(reply, await lms.updateLesson(actorOf(req), id, patch, ifMatch(req), reqInfo(req)))
  })
  app.delete('/lessons/:id', { preHandler: app.authorize('courses:write') }, async (req, reply) => {
    await lms.removeLesson(actorOf(req), idParam.parse(req.params).id, reqInfo(req))
    return reply.status(204).send()
  })
  app.put('/lessons/:id/progress', { config: limit(config, 240), preHandler: app.authorize('lessons:progress_own') }, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ status: z.enum(['in_progress', 'completed']) }).strict().parse(req.body)
    return lms.setLessonProgress(actorOf(req), id, body.status)
  })

  // ---------------- localized content (translation records keyed by item + language) ----------------
  const trBody = z.object({ title: text(200).min(2), description: text(4000).nullable().optional(), content: text(50_000).nullable().optional() }).strict()
  const kinds: Array<[string, TranslatableKind]> = [['courses', 'course'], ['modules', 'module'], ['lessons', 'lesson']]
  for (const [plural, kind] of kinds) {
    app.get(`/${plural}/:id/translations`, { preHandler: app.authorize('courses:read') }, async (req) => lms.listTranslations(actorOf(req), kind, idParam.parse(req.params).id))
    app.put(`/${plural}/:id/translations/:lang`, { config: limit(config, 120), preHandler: app.authorize('courses:write') }, async (req, reply) => {
      const { id, lang } = z.object({ id: uuid, lang: z.string().regex(LANGUAGE_RE) }).parse(req.params)
      const raw = req.headers['if-match']
      const out = await lms.putTranslation(actorOf(req), kind, id, lang, trBody.parse(req.body), raw === undefined ? undefined : ifMatch(req), reqInfo(req))
      return versioned(reply, out)
    })
    app.delete(`/${plural}/:id/translations/:lang`, { preHandler: app.authorize('courses:write') }, async (req, reply) => {
      const { id, lang } = z.object({ id: uuid, lang: z.string().regex(LANGUAGE_RE) }).parse(req.params)
      await lms.removeTranslation(actorOf(req), kind, id, lang, reqInfo(req))
      return reply.status(204).send()
    })
  }

  // ---------------- resources (external links; file uploads arrive with Part 7) ----------------
  const resourceType = z.enum(['document', 'video', 'link', 'presentation', 'other'])
  const oneTarget = (t: { courseId?: string; lessonId?: string; batchId?: string }) => [t.courseId, t.lessonId, t.batchId].filter(Boolean).length === 1
  app.get('/resources', { preHandler: app.authorize('courses:read') }, async (req) => {
    const t = z.object({ courseId: uuid.optional(), lessonId: uuid.optional(), batchId: uuid.optional() }).refine(oneTarget, 'Provide exactly one of courseId, lessonId, batchId').parse(req.query)
    return lms.listResources(actorOf(req), t, parseSort(q(req).sort, resourceSort, { key: 'created_at', dir: 'DESC' }), parsePageParams(q(req)))
  })
  app.post('/resources', { config: limit(config, 60), preHandler: app.authorize('courses:write') }, async (req, reply) => {
    const body = z.object({ courseId: uuid.optional(), lessonId: uuid.optional(), batchId: uuid.optional(), title: text(200).min(2), description: text(2000).nullable().optional(), resourceType: resourceType.optional(), externalUrl: httpUrl })
      .strict().refine(oneTarget, 'Provide exactly one of courseId, lessonId, batchId').parse(req.body)
    return reply.status(201).send(versioned(reply, await lms.createResource(actorOf(req), body, reqInfo(req))))
  })
  app.get('/resources/:id', { preHandler: app.authorize('courses:read') }, async (req, reply) => {
    return versioned(reply, await lms.getResource(actorOf(req), idParam.parse(req.params).id))
  })
  app.patch('/resources/:id', { preHandler: app.authorize('courses:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const patch = z.object({ title: text(200).min(2).optional(), description: text(2000).nullable().optional(), resourceType: resourceType.optional(), externalUrl: httpUrl.optional() }).strict().refine(nonEmpty, 'Provide at least one field').parse(req.body)
    return versioned(reply, await lms.updateResource(actorOf(req), id, patch, ifMatch(req), reqInfo(req)))
  })
  app.delete('/resources/:id', { preHandler: app.authorize('courses:write') }, async (req, reply) => {
    await lms.removeResource(actorOf(req), idParam.parse(req.params).id, reqInfo(req))
    return reply.status(204).send()
  })

  // ---------------- class sessions and timetable ----------------
  const mode = z.enum(['offline', 'online'])
  const sessionStatus = z.enum(['scheduled', 'live', 'completed', 'cancelled'])
  app.get('/sessions', { preHandler: app.authorize('classes:read') }, async (req) => {
    const f = z.object({ batchId: uuid.optional(), trainerId: uuid.optional(), status: sessionStatus.optional(), mode: mode.optional(), from: dateTime.optional(), to: dateTime.optional(), institutionId: uuid.optional(), q: text(100).optional() }).parse(req.query)
    return sessions.list(actorOf(req), f, parseSort(q(req).sort, sessionSort, { key: 'starts_at', dir: 'ASC' }), parsePageParams(q(req)))
  })
  app.get('/timetable', { preHandler: app.authorize('classes:read') }, async (req) => {
    const f = z.object({ from: dateTime, to: dateTime, batchId: uuid.optional(), trainerId: uuid.optional(), institutionId: uuid.optional() }).parse(req.query)
    return sessions.timetable(actorOf(req), f)
  })
  app.post('/sessions', { config: limit(config, 120), preHandler: app.authorize('classes:write') }, async (req, reply) => {
    const body = z.object({ batchId: uuid, title: text(200).min(2), startsAt: dateTime, endsAt: dateTime, mode: mode.optional(), joinUrl: httpUrl.nullable().optional(), location: text(300).nullable().optional() }).strict().parse(req.body)
    return reply.status(201).send(versioned(reply, await sessions.create(actorOf(req), body, reqInfo(req))))
  })
  app.get('/sessions/:id', { preHandler: app.authorize('classes:read') }, async (req, reply) => {
    return versioned(reply, await sessions.get(actorOf(req), idParam.parse(req.params).id))
  })
  app.patch('/sessions/:id', { preHandler: app.authorize('classes:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const patch = z.object({ title: text(200).min(2).optional(), startsAt: dateTime.optional(), endsAt: dateTime.optional(), mode: mode.optional(), joinUrl: httpUrl.nullable().optional(), location: text(300).nullable().optional() }).strict().refine(nonEmpty, 'Provide at least one field').parse(req.body)
    return versioned(reply, await sessions.update(actorOf(req), id, patch, ifMatch(req), reqInfo(req)))
  })
  app.post('/sessions/:id/status', { config: limit(config, 120), preHandler: app.authorize('classes:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ status: z.enum(['live', 'completed', 'cancelled']) }).strict().parse(req.body)
    return versioned(reply, await sessions.transition(actorOf(req), id, body.status, reqInfo(req)))
  })
  app.delete('/sessions/:id', { preHandler: app.authorize('classes:write') }, async (req, reply) => {
    await sessions.remove(actorOf(req), idParam.parse(req.params).id, reqInfo(req))
    return reply.status(204).send()
  })

  // ---------------- attendance ----------------
  app.get('/attendance', { preHandler: app.authorize('attendance:read') }, async (req) => {
    const f = z.object({ sessionId: uuid.optional(), batchId: uuid.optional(), traineeId: uuid.optional(), status: z.enum(ATTENDANCE_STATUSES).optional(), from: dateTime.optional(), to: dateTime.optional(), institutionId: uuid.optional() }).parse(req.query)
    return attendance.list(actorOf(req), f, parseSort(q(req).sort, attendanceSort, { key: 'created_at', dir: 'DESC' }), parsePageParams(q(req)))
  })
  app.get('/attendance/summary', { preHandler: app.authorize('attendance:read') }, async (req) => {
    const f = z.object({ batchId: uuid, traineeId: uuid.optional() }).parse(req.query)
    return attendance.summary(actorOf(req), f.batchId, f.traineeId)
  })
  app.put('/attendance/sessions/:id', { config: limit(config, 120), preHandler: app.authorize('attendance:mark') }, async (req) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ records: z.array(z.object({ traineeId: uuid, status: z.enum(ATTENDANCE_STATUSES), method: z.enum(['manual', 'online']).optional(), checkedInAt: dateTime.nullable().optional(), notes: text(500).nullable().optional() }).strict()).min(1).max(500) }).strict().parse(req.body)
    return attendance.markBulk(actorOf(req), id, body.records, reqInfo(req))
  })
  app.post('/attendance/sessions/:id/check-in', { config: limit(config, 30), preHandler: app.authorize('attendance:checkin_own') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ method: z.enum(['manual', 'online']).optional() }).strict().parse(req.body ?? {})
    return reply.status(201).send(await attendance.selfCheckIn(actorOf(req), id, body.method, reqInfo(req)))
  })

  // ---- verified attendance: open/close, rotating QR, fingerprint provider, optional face ----
  app.get('/attendance/methods', { preHandler: app.authorize('attendance:read') }, async () => attendance.methods())
  app.get('/attendance/sessions/:id/state', { preHandler: app.authorize('attendance:read') }, async (req) => attendance.attendanceState(actorOf(req), idParam.parse(req.params).id))
  app.post('/attendance/sessions/:id/open', { config: limit(config, 60), preHandler: app.authorize('attendance:mark') }, async (req) =>
    attendance.openAttendance(actorOf(req), idParam.parse(req.params).id, reqInfo(req)))
  app.post('/attendance/sessions/:id/close', { config: limit(config, 60), preHandler: app.authorize('attendance:mark') }, async (req) =>
    attendance.closeAttendance(actorOf(req), idParam.parse(req.params).id, reqInfo(req)))
  app.get('/attendance/sessions/:id/qr', { config: limit(config, 120), preHandler: app.authorize('attendance:mark') }, async (req, reply) => {
    reply.header('cache-control', 'no-store')
    return attendance.currentQr(actorOf(req), idParam.parse(req.params).id)
  })
  app.post('/attendance/sessions/:id/verify/qr', { config: limit(config, 30), preHandler: app.authorize('attendance:checkin_own') }, async (req, reply) => {
    const body = z.object({ token: z.string().min(20).max(200) }).strict().parse(req.body)
    return reply.status(201).send(await attendance.verifyQr(actorOf(req), idParam.parse(req.params).id, body.token, reqInfo(req)))
  })
  app.post('/attendance/sessions/:id/verify/fingerprint', { config: limit(config, 30), preHandler: app.authorize('attendance:checkin_own') }, async (req, reply) => {
    const body = z.object({ simulatedKey: z.string().max(20).optional(), deviceProof: z.string().max(4000).optional() }).strict().parse(req.body ?? {})
    return reply.status(201).send(await attendance.verifyFingerprint(actorOf(req), idParam.parse(req.params).id, body, reqInfo(req)))
  })
  app.post('/attendance/sessions/:id/verify/face', { config: limit(config, 30), preHandler: app.authorize('attendance:checkin_own') }, async (req, reply) => {
    const body = z.object({ proof: z.string().max(2_000_000).optional() }).strict().parse(req.body ?? {})
    return reply.status(201).send(await attendance.verifyFace(actorOf(req), idParam.parse(req.params).id, body, reqInfo(req)))
  })

  // ---------------- assessments ----------------
  const assessmentFields = {
    courseId: uuid.nullable().optional(), title: text(200).min(2), assessmentType: assessmentType.optional(), totalMarks: z.number().positive().max(10_000), passMarks: z.number().min(0).max(10_000),
    maxAttempts: z.number().int().min(1).max(20).optional(), opensAt: dateTime.nullable().optional(), dueAt: dateTime.nullable().optional(), questions: z.array(question).max(200).optional(),
  }
  app.get('/assessments', { preHandler: app.authorize('assessments:read') }, async (req) => {
    const f = z.object({ batchId: uuid.optional(), courseId: uuid.optional(), status: z.enum(['draft', 'published', 'closed']).optional(), assessmentType: assessmentType.optional(), q: text(100).optional(), institutionId: uuid.optional() }).parse(req.query)
    return assessments.list(actorOf(req), f, parseSort(q(req).sort, assessmentSort, { key: 'created_at', dir: 'DESC' }), parsePageParams(q(req)))
  })
  app.get('/assessments/summary', { preHandler: app.authorize('assessments:read') }, async (req) => {
    const f = z.object({ batchId: uuid, traineeId: uuid.optional() }).parse(req.query)
    return assessments.summary(actorOf(req), f.batchId, f.traineeId)
  })
  app.post('/assessments', { config: limit(config, 60), preHandler: app.authorize('assessments:write') }, async (req, reply) => {
    const body = z.object({ batchId: uuid, ...assessmentFields }).strict().parse(req.body)
    return reply.status(201).send(versioned(reply, await assessments.create(actorOf(req), body, reqInfo(req))))
  })
  app.get('/assessments/:id', { preHandler: app.authorize('assessments:read') }, async (req, reply) => {
    return versioned(reply, await assessments.get(actorOf(req), idParam.parse(req.params).id))
  })
  app.patch('/assessments/:id', { preHandler: app.authorize('assessments:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const patch = z.object({ ...assessmentFields, title: assessmentFields.title.optional(), totalMarks: assessmentFields.totalMarks.optional(), passMarks: assessmentFields.passMarks.optional() }).strict().refine(nonEmpty, 'Provide at least one field').parse(req.body)
    return versioned(reply, await assessments.update(actorOf(req), id, patch, ifMatch(req), reqInfo(req)))
  })
  app.post('/assessments/:id/status', { config: limit(config, 60), preHandler: app.authorize('assessments:write') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ status: z.enum(['published', 'closed']) }).strict().parse(req.body)
    return versioned(reply, await assessments.transition(actorOf(req), id, body.status, reqInfo(req)))
  })
  app.delete('/assessments/:id', { preHandler: app.authorize('assessments:write') }, async (req, reply) => {
    await assessments.remove(actorOf(req), idParam.parse(req.params).id, reqInfo(req))
    return reply.status(204).send()
  })
  app.post('/assessments/:id/attempts', { config: limit(config, 30), preHandler: app.authorize('assessments:attempt_own') }, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = z.object({ answers: z.record(z.string().max(40), z.string().max(10_000)).refine((a) => Object.keys(a).length <= 200, 'Too many answers') }).strict().parse(req.body)
    return reply.status(201).send(await assessments.submitAttempt(actorOf(req), id, body.answers, reqInfo(req)))
  })
  app.get('/assessments/:id/results', { preHandler: app.authorize('assessments:read') }, async (req) => {
    const { id } = idParam.parse(req.params)
    const f = z.object({ traineeId: uuid.optional(), status: z.enum(['in_progress', 'submitted', 'graded']).optional() }).parse(req.query)
    return assessments.listResults(actorOf(req), id, f, parseSort(q(req).sort, resultSort, { key: 'created_at', dir: 'DESC' }), parsePageParams(q(req)))
  })
  app.post('/assessments/:id/results/:resultId/grade', { config: limit(config, 240), preHandler: app.authorize('assessments:write') }, async (req, reply) => {
    const { id, resultId } = z.object({ id: uuid, resultId: uuid }).parse(req.params)
    const body = z.object({ score: z.number().min(0).max(10_000), feedback: text(2000).nullable().optional() }).strict().parse(req.body)
    return versioned(reply, await assessments.grade(actorOf(req), id, resultId, body, ifMatch(req), reqInfo(req)))
  })
}
