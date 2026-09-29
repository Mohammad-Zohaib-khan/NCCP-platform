import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { buildUpdate, keysetList, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { scopeInstitutionIds, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { assertInstitutionActive } from '../institutions/service.js'
import { capacityStatusesSql } from '../training/constants.js'
import { auditBase, batchVisibilitySql, loadBatch, traineeIdOfUser, type Row } from './access.js'
import {
  assertAttemptAllowed, gradeMcq, isAutoGradable, isPassing, stripAnswerKey, validateAnswers, validateMarks, validateQuestions, type Question,
} from './assessments.rules.js'

export type AssessmentType = 'quiz' | 'assignment' | 'practical' | 'final_exam'
export type AssessmentStatus = 'draft' | 'published' | 'closed'
export interface AssessmentFilter { batchId?: string; courseId?: string; status?: AssessmentStatus; assessmentType?: AssessmentType; q?: string; institutionId?: string }
export interface AssessmentCreate {
  batchId: string; courseId?: string | null; title: string; assessmentType?: AssessmentType; totalMarks: number; passMarks: number; maxAttempts?: number
  opensAt?: string | null; dueAt?: string | null; questions?: Question[]
}
export type AssessmentPatch = Partial<Omit<AssessmentCreate, 'batchId'>>

const COLS = `a.id, a.batch_id, b.code AS batch_code, b.institution_id, a.course_id, a.title, a.assessment_type, a.total_marks::float8 AS total_marks, a.pass_marks::float8 AS pass_marks,
  a.max_attempts, a.opens_at, a.due_at, a.questions, a.status, a.version, a.created_at`
const FROM = `assessments a JOIN batches b ON b.id = a.batch_id LEFT JOIN trainers tr ON tr.id = b.trainer_id`

const isStaff = (a: AuthContext): boolean => a.role !== 'trainee'
/** Staff see the answer key; trainees never do. */
export function toAssessmentDto(r: Row, staff: boolean) {
  const questions = (r.questions as Question[]) ?? []
  return {
    id: r.id as string, batchId: r.batch_id as string, batchCode: r.batch_code as string, institutionId: r.institution_id as string, courseId: (r.course_id as string | null) ?? null,
    title: r.title as string, assessmentType: r.assessment_type as AssessmentType, totalMarks: r.total_marks as number, passMarks: r.pass_marks as number, maxAttempts: r.max_attempts as number,
    opensAt: (r.opens_at as Date | null) ?? null, dueAt: (r.due_at as Date | null) ?? null, status: r.status as AssessmentStatus, questions: staff ? questions : stripAnswerKey(questions),
    autoGraded: isAutoGradable(questions), version: r.version as number, createdAt: r.created_at as Date,
  }
}
const RCOLS = `r.id, r.assessment_id, r.trainee_id, u.full_name AS trainee_name, r.attempt_no, r.answers, r.score::float8 AS score, r.passed, r.status, r.feedback, r.submitted_at, r.graded_at, r.version, r.created_at`
const RFROM = `assessment_results r JOIN trainees t ON t.id = r.trainee_id JOIN users u ON u.id = t.user_id`
function toResultDto(r: Row, staff: boolean) {
  const graded = r.status === 'graded'
  return {
    id: r.id as string, assessmentId: r.assessment_id as string, traineeId: r.trainee_id as string, traineeName: r.trainee_name as string, attemptNo: r.attempt_no as number,
    ...(staff ? { answers: r.answers as Record<string, unknown> } : {}),
    status: r.status as string, score: graded ? (r.score as number | null) : null, passed: graded ? (r.passed as boolean | null) : null,
    feedback: graded ? ((r.feedback as string | null) ?? null) : null, submittedAt: (r.submitted_at as Date | null) ?? null, gradedAt: (r.graded_at as Date | null) ?? null, version: r.version as number,
  }
}

export function createAssessmentsService(db: Db) {
  function visibility(actor: AuthContext, params: unknown[]): string {
    const base = batchVisibilitySql(actor, params)
    return actor.role === 'trainee' ? `(${base} AND a.status IN ('published','closed'))` : base
  }
  async function load(client: Db | Tx, actor: AuthContext, id: string, lock = false): Promise<Row> {
    const params: unknown[] = [id]
    const r = await client.query(`SELECT ${COLS} FROM ${FROM} WHERE a.id = $1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND ${visibility(actor, params)}${lock ? ' FOR UPDATE OF a' : ''}`, params)
    if (!r.rows[0]) throw AppError.notFound('Assessment')
    return r.rows[0] as Row
  }

  async function list(actor: AuthContext, f: AssessmentFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['a.deleted_at IS NULL', 'b.deleted_at IS NULL', visibility(actor, params)]
    if (f.institutionId) { const ids = scopeInstitutionIds(actor, f.institutionId); if (ids) { params.push(ids); where.push(`b.institution_id = ANY($${params.length}::uuid[])`) } }
    if (f.batchId) { params.push(f.batchId); where.push(`a.batch_id = $${params.length}::uuid`) }
    if (f.courseId) { params.push(f.courseId); where.push(`a.course_id = $${params.length}::uuid`) }
    if (f.status) { params.push(f.status); where.push(`a.status = $${params.length}`) }
    if (f.assessmentType) { params.push(f.assessmentType); where.push(`a.assessment_type = $${params.length}`) }
    if (f.q) { params.push(likePattern(f.q)); where.push(`a.title ILIKE $${params.length}`) }
    const staff = isStaff(actor)
    return keysetList(db, { select: COLS, from: FROM, where, params, sort, idExpr: 'a.id', page, map: (r) => toAssessmentDto(r, staff) })
  }
  async function get(actor: AuthContext, id: string) { return toAssessmentDto(await load(db, actor, id), isStaff(actor)) }

  function checkWindow(opensAt?: string | null, dueAt?: string | null): void {
    if (opensAt && Number.isNaN(Date.parse(opensAt))) throw AppError.validation([{ path: 'opensAt', message: 'Not a valid date-time' }])
    if (dueAt && Number.isNaN(Date.parse(dueAt))) throw AppError.validation([{ path: 'dueAt', message: 'Not a valid date-time' }])
    if (opensAt && dueAt && Date.parse(dueAt) <= Date.parse(opensAt)) throw AppError.validation([{ path: 'dueAt', message: 'dueAt must be after opensAt' }])
  }
  async function assertCourseInBatchProgramme(tx: Tx, courseId: string, programmeId: string): Promise<void> {
    const ok = await tx.query(`SELECT 1 FROM courses WHERE id = $1 AND programme_id = $2 AND deleted_at IS NULL`, [courseId, programmeId])
    if (!ok.rows[0]) throw AppError.validation([{ path: 'courseId', message: 'Course not found in this batch\'s programme' }])
  }

  async function create(actor: AuthContext, input: AssessmentCreate, info: ReqInfo) {
    const id = await withTransaction(db, async (tx) => {
      const batch = await loadBatch(tx, actor, input.batchId, 'teach')
      if (batch.status !== 'planned' && batch.status !== 'ongoing') throw AppError.conflict(`A ${batch.status} batch cannot get new assessments`)
      await assertInstitutionActive(tx, batch.institutionId)
      validateMarks(input.totalMarks, input.passMarks)
      validateQuestions(input.questions ?? [], input.totalMarks)
      checkWindow(input.opensAt, input.dueAt)
      if (input.courseId) await assertCourseInBatchProgramme(tx, input.courseId, batch.programmeId)
      const newId = ((await tx.query(
        `INSERT INTO assessments (batch_id, course_id, title, assessment_type, total_marks, pass_marks, max_attempts, opens_at, due_at, questions, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10::jsonb,$11) RETURNING id`,
        [batch.id, input.courseId ?? null, input.title.trim(), input.assessmentType ?? 'quiz', input.totalMarks, input.passMarks, input.maxAttempts ?? 1, input.opensAt ?? null, input.dueAt ?? null,
         JSON.stringify(input.questions ?? []), actor.userId])).rows[0] as Row).id as string
      await writeAudit(tx, { ...auditBase(actor, info), action: 'assessment.create', entityType: 'assessment', entityId: newId, institutionId: batch.institutionId, changes: { batchId: batch.id, title: input.title, questions: (input.questions ?? []).length } })
      return newId
    })
    return get(actor, id)
  }

  /** Draft: everything editable. Published: only the opening and due times. Closed: nothing. */
  async function update(actor: AuthContext, id: string, patch: AssessmentPatch, expectedVersion: number, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const cur = await load(tx, actor, id, true)
      const batch = await loadBatch(tx, actor, cur.batch_id as string, 'teach')
      if ((cur.version as number) !== expectedVersion) throw AppError.preconditionFailed()
      const status = cur.status as AssessmentStatus
      if (status === 'closed') throw AppError.conflict('A closed assessment cannot be edited')
      const touched = Object.keys(patch).filter((k) => (patch as Row)[k] !== undefined)
      if (status === 'published' && touched.some((k) => k !== 'opensAt' && k !== 'dueAt')) throw AppError.conflict('A published assessment only allows changing opensAt and dueAt')
      const totalMarks = patch.totalMarks ?? (cur.total_marks as number)
      const passMarks = patch.passMarks ?? (cur.pass_marks as number)
      validateMarks(totalMarks, passMarks)
      if (patch.questions !== undefined || patch.totalMarks !== undefined) validateQuestions(patch.questions ?? (cur.questions as Question[]), totalMarks)
      checkWindow(patch.opensAt !== undefined ? patch.opensAt : (cur.opens_at as Date | null)?.toISOString(), patch.dueAt !== undefined ? patch.dueAt : (cur.due_at as Date | null)?.toISOString())
      if (patch.courseId) await assertCourseInBatchProgramme(tx, patch.courseId, batch.programmeId)
      const q = buildUpdate({ table: 'assessments', id, expectedVersion, returning: 'id', jsonColumns: ['questions'],
        sets: { course_id: patch.courseId, title: patch.title?.trim(), assessment_type: patch.assessmentType, total_marks: patch.totalMarks, pass_marks: patch.passMarks, max_attempts: patch.maxAttempts,
                opens_at: patch.opensAt, due_at: patch.dueAt, questions: patch.questions } })
      if (!(await tx.query(q.sql, q.params)).rows[0]) throw AppError.preconditionFailed()
      await writeAudit(tx, { ...auditBase(actor, info), action: 'assessment.update', entityType: 'assessment', entityId: id, institutionId: batch.institutionId, changes: { fields: touched } })
    })
    return get(actor, id)
  }

  async function transition(actor: AuthContext, id: string, target: 'published' | 'closed', info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const cur = await load(tx, actor, id, true)
      const batch = await loadBatch(tx, actor, cur.batch_id as string, 'teach')
      const from = cur.status as AssessmentStatus
      if (target === 'published') {
        if (from !== 'draft') throw AppError.conflict(`A ${from} assessment cannot be published`)
        if (batch.status === 'cancelled' || batch.status === 'completed') throw AppError.conflict(`A ${batch.status} batch cannot publish assessments`)
        const questions = cur.questions as Question[]
        if (questions.length === 0 && ['quiz', 'final_exam'].includes(cur.assessment_type as string)) throw AppError.conflict('A quiz or final exam needs questions before it can be published')
      } else if (from !== 'published') throw AppError.conflict(`A ${from} assessment cannot be closed`)
      await tx.query(`UPDATE assessments SET status = $2 WHERE id = $1`, [id, target])
      await writeAudit(tx, { ...auditBase(actor, info), action: `assessment.${target === 'published' ? 'publish' : 'close'}`, entityType: 'assessment', entityId: id, institutionId: batch.institutionId, changes: { from, to: target } })
    })
    return get(actor, id)
  }

  async function remove(actor: AuthContext, id: string, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const cur = await load(tx, actor, id, true)
      const batch = await loadBatch(tx, actor, cur.batch_id as string, 'teach')
      const n = ((await tx.query(`SELECT count(*)::int AS n FROM assessment_results WHERE assessment_id = $1`, [id])).rows[0] as Row).n as number
      if (n > 0) throw AppError.conflict('The assessment has submissions; close it instead', { submissions: n })
      await tx.query(`UPDATE assessments SET deleted_at = now() WHERE id = $1`, [id])
      await writeAudit(tx, { ...auditBase(actor, info), action: 'assessment.delete', entityType: 'assessment', entityId: id, institutionId: batch.institutionId })
    })
  }

  // ------------------------------------------------------------ attempts and grading
  /** A trainee submits an attempt. All-multiple-choice assessments are graded on the spot; anything else waits for a grader. */
  async function submitAttempt(actor: AuthContext, assessmentId: string, answers: Record<string, unknown>, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const traineeId = await traineeIdOfUser(tx, actor.userId)
      if (!traineeId) throw AppError.forbidden('Only trainees can attempt assessments')
      const a = await load(tx, actor, assessmentId)                                   // 404 unless published and they hold a seat
      const active = await tx.query(`SELECT 1 FROM batch_enrolments WHERE batch_id = $1 AND trainee_id = $2 AND status IN ('enrolled','in_progress')`, [a.batch_id, traineeId])
      if (!active.rows[0]) throw AppError.conflict('Only active enrolments can attempt assessments')
      // Serialise this trainee's attempts on this assessment so the attempt limit cannot be beaten by parallel requests.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [`attempt:${assessmentId}:${traineeId}`])
      const used = ((await tx.query(`SELECT count(*)::int AS n FROM assessment_results WHERE assessment_id = $1 AND trainee_id = $2`, [assessmentId, traineeId])).rows[0] as Row).n as number
      assertAttemptAllowed({ status: a.status as string, opensAt: a.opens_at as Date | null, dueAt: a.due_at as Date | null, maxAttempts: a.max_attempts as number, attemptsUsed: used })
      const questions = a.questions as Question[]
      validateAnswers(questions, answers)
      const auto = isAutoGradable(questions)
      const score = auto ? gradeMcq(questions, answers) : null
      const passed = score === null ? null : isPassing(score, a.pass_marks as number)
      let row: Row
      try {
        row = (await tx.query(
          `INSERT INTO assessment_results (assessment_id, trainee_id, attempt_no, answers, score, passed, status, submitted_at, graded_at)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,now(), CASE WHEN $7::text = 'graded' THEN now() END) RETURNING id`,
          [assessmentId, traineeId, used + 1, JSON.stringify(answers), score, passed, auto ? 'graded' : 'submitted'])).rows[0] as Row
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw AppError.conflict('Another attempt was submitted at the same time; retry')
        throw err
      }
      await writeAudit(tx, { ...auditBase(actor, info), action: 'assessment.attempt', entityType: 'assessment', entityId: assessmentId, institutionId: a.institution_id as string, changes: { attemptNo: used + 1, autoGraded: auto, passed } })
      const res = (await tx.query(`SELECT ${RCOLS} FROM ${RFROM} WHERE r.id = $1`, [row.id])).rows[0] as Row
      return toResultDto(res, false)
    })
  }

  async function listResults(actor: AuthContext, assessmentId: string, f: { traineeId?: string; status?: string }, sort: ParsedSort, page: PageParams) {
    await load(db, actor, assessmentId)
    const params: unknown[] = [assessmentId]
    const where = ['r.assessment_id = $1::uuid']
    if (actor.role === 'trainee') { params.push(actor.userId); where.push(`t.user_id = $${params.length}`) }
    if (f.traineeId) { params.push(f.traineeId); where.push(`r.trainee_id = $${params.length}::uuid`) }
    if (f.status) { params.push(f.status); where.push(`r.status = $${params.length}`) }
    const staff = isStaff(actor)
    return keysetList(db, { select: RCOLS, from: RFROM, where, params, sort, idExpr: 'r.id', page, map: (r) => toResultDto(r, staff) })
  }

  /** Manual grading (or regrading). Needs the result's current version in If-Match, so two graders cannot overwrite each other. */
  async function grade(actor: AuthContext, assessmentId: string, resultId: string, input: { score: number; feedback?: string | null }, expectedVersion: number, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const a = await load(tx, actor, assessmentId)
      const batch = await loadBatch(tx, actor, a.batch_id as string, 'teach')
      const cur = (await tx.query(`SELECT version, status FROM assessment_results WHERE id = $1 AND assessment_id = $2 FOR UPDATE`, [resultId, assessmentId])).rows[0] as Row | undefined
      if (!cur) throw AppError.notFound('Result')
      if ((cur.version as number) !== expectedVersion) throw AppError.preconditionFailed()
      if (cur.status === 'in_progress') throw AppError.conflict('This attempt has not been submitted yet')
      if (input.score > (a.total_marks as number)) throw AppError.validation([{ path: 'score', message: `score cannot exceed totalMarks (${String(a.total_marks)})` }])
      const passed = isPassing(input.score, a.pass_marks as number)
      await tx.query(`UPDATE assessment_results SET score = $2, passed = $3, status = 'graded', feedback = $4, graded_by = $5, graded_at = now() WHERE id = $1`, [resultId, input.score, passed, input.feedback ?? null, actor.userId])
      await writeAudit(tx, { ...auditBase(actor, info), action: 'assessment.grade', entityType: 'assessment_result', entityId: resultId, institutionId: batch.institutionId, changes: { assessmentId, score: input.score, passed, regrade: cur.status === 'graded' } })
      const res = (await tx.query(`SELECT ${RCOLS} FROM ${RFROM} WHERE r.id = $1`, [resultId])).rows[0] as Row
      return toResultDto(res, true)
    })
  }

  /** For each seat holder in a batch: how many published/closed assessments exist and how many they have passed. Feeds certificates in Part 5. */
  async function summary(actor: AuthContext, batchId: string, traineeId?: string) {
    const batch = await loadBatch(db, actor, batchId, 'read')
    let only = traineeId ?? null
    if (actor.role === 'trainee') only = await traineeIdOfUser(db, actor.userId)
    const r = await db.query(
      `WITH pub AS (SELECT id FROM assessments WHERE batch_id = $1 AND status IN ('published','closed') AND deleted_at IS NULL)
       SELECT e.trainee_id, u.full_name AS trainee_name, (SELECT count(*)::int FROM pub) AS total,
         (SELECT count(DISTINCT r.assessment_id)::int FROM assessment_results r WHERE r.trainee_id = e.trainee_id AND r.status = 'graded' AND r.passed IS TRUE AND r.assessment_id IN (SELECT id FROM pub)) AS passed
       FROM batch_enrolments e JOIN trainees t ON t.id = e.trainee_id JOIN users u ON u.id = t.user_id
       WHERE e.batch_id = $1 AND t.deleted_at IS NULL AND e.status IN (${capacityStatusesSql()}) AND ($2::uuid IS NULL OR e.trainee_id = $2::uuid)
       ORDER BY u.full_name, e.trainee_id`, [batch.id, only])
    return { batchId: batch.id, batchCode: batch.code, data: (r.rows as Row[]).map((x) => ({
      traineeId: x.trainee_id as string, traineeName: x.trainee_name as string, assessments: x.total as number, passed: x.passed as number,
      allPassed: (x.total as number) > 0 && x.passed === x.total })) }
  }

  return { list, get, create, update, transition, remove, submitAttempt, listResults, grade, summary }
}
export type AssessmentsService = ReturnType<typeof createAssessmentsService>
