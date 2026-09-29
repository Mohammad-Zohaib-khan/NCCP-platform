import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { buildUpdate, keysetList, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import type { AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { assertInstitutionActive } from '../institutions/service.js'
import { capacityStatusesSql } from '../training/constants.js'
import { assertEnabledLanguage, overlayText, type I18nConfig } from '../../lib/i18n.js'
import { auditBase, loadBatch, recomputeProgress, traineeIdOfUser, type Row } from './access.js'

export type CourseStatus = 'draft' | 'published' | 'archived'
export type LessonType = 'video' | 'reading' | 'document' | 'quiz' | 'live'
export type ResourceType = 'document' | 'video' | 'link' | 'presentation' | 'other'
export interface CourseFilter { programmeId?: string; status?: CourseStatus; q?: string }
export interface ResourceTarget { courseId?: string; lessonId?: string; batchId?: string }

/** Where a piece of content lives, enough to decide who may read or change it. */
interface Chain { id: string; programmeId: string; institutionId: string | null; courseStatus: string; version: number }
const CHAIN_SQL = {
  course: `SELECT c.id, c.programme_id, p.institution_id, c.status, c.version FROM courses c JOIN programmes p ON p.id = c.programme_id
           WHERE c.id = $1 AND c.deleted_at IS NULL AND p.deleted_at IS NULL`,
  module: `SELECT m.id, c.programme_id, p.institution_id, c.status, m.version FROM modules m JOIN courses c ON c.id = m.course_id AND c.deleted_at IS NULL
           JOIN programmes p ON p.id = c.programme_id AND p.deleted_at IS NULL WHERE m.id = $1 AND m.deleted_at IS NULL`,
  lesson: `SELECT l.id, c.programme_id, p.institution_id, c.status, l.version FROM lessons l JOIN modules m ON m.id = l.module_id AND m.deleted_at IS NULL
           JOIN courses c ON c.id = m.course_id AND c.deleted_at IS NULL JOIN programmes p ON p.id = c.programme_id AND p.deleted_at IS NULL
           WHERE l.id = $1 AND l.deleted_at IS NULL`,
} as const
type ChainKind = keyof typeof CHAIN_SQL

const COURSE_COLS = `c.id, c.programme_id, p.title AS programme_title, c.title, c.description, c.position, c.status, c.version, c.created_at`
const COURSE_FROM = `courses c JOIN programmes p ON p.id = c.programme_id`
export const toCourseDto = (r: Row) => ({
  id: r.id as string, programmeId: r.programme_id as string, programmeTitle: r.programme_title as string, title: r.title as string,
  description: (r.description as string | null) ?? null, position: r.position as number, status: r.status as CourseStatus, version: r.version as number, createdAt: r.created_at as Date,
})
const toResourceDto = (r: Row) => ({
  id: r.id as string, title: r.title as string, description: (r.description as string | null) ?? null, resourceType: r.resource_type as ResourceType,
  externalUrl: (r.external_url as string | null) ?? null, courseId: (r.course_id as string | null) ?? null, lessonId: (r.lesson_id as string | null) ?? null,
  batchId: (r.batch_id as string | null) ?? null, createdAt: r.created_at as Date, version: r.version as number,
})
const RESOURCE_COLS = `r.id, r.title, r.description, r.resource_type, r.external_url, r.course_id, r.lesson_id, r.batch_id, r.created_at, r.version`

export type TranslatableKind = 'course' | 'module' | 'lesson'
/** Which text fields each kind may localise. Title is always required; anything else is optional. */
export const TRANSLATABLE_FIELDS: Record<TranslatableKind, readonly ('title' | 'description' | 'content')[]> = {
  course: ['title', 'description'], module: ['title'], lesson: ['title', 'content'],
}
export interface TranslationInput { title: string; description?: string | null; content?: string | null }
type TrRow = { title: string; description: string | null; content: string | null }

export function createLmsService(db: Db, i18n: I18nConfig = { defaultLanguage: 'en', enabledLanguages: ['en'] }) {
  /** Translations of `kind` items into `lang`, keyed by entity id. Empty for the default language (base rows are the default text). */
  async function translationsFor(client: Db | Tx, kind: TranslatableKind, ids: string[], lang: string | undefined): Promise<Map<string, TrRow>> {
    const m = new Map<string, TrRow>()
    if (!lang || lang === i18n.defaultLanguage || ids.length === 0) return m
    const r = await client.query(`SELECT entity_id, title, description, content FROM content_translations WHERE entity_type = $1 AND language = $2 AND entity_id = ANY($3::uuid[])`, [kind, lang, ids])
    for (const x of r.rows as Row[]) m.set(x.entity_id as string, { title: x.title as string, description: (x.description as string | null) ?? null, content: (x.content as string | null) ?? null })
    return m
  }
  const langMeta = (lang: string | undefined) => ({ language: lang ?? i18n.defaultLanguage, fallbackLanguage: i18n.defaultLanguage })

  // ------------------------------------------------------------ access
  async function traineeHasSeatInProgramme(client: Db | Tx, userId: string, programmeId: string): Promise<boolean> {
    const r = await client.query(
      `SELECT 1 FROM batch_enrolments e JOIN batches b ON b.id = e.batch_id AND b.deleted_at IS NULL JOIN trainees t ON t.id = e.trainee_id
       WHERE b.programme_id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL AND e.status IN (${capacityStatusesSql()}) LIMIT 1`, [programmeId, userId])
    return r.rows.length > 0
  }
  async function canRead(client: Db | Tx, actor: AuthContext, c: Chain): Promise<boolean> {
    if (actor.role === 'super_admin') return true
    if (actor.role === 'institution_admin' || actor.role === 'trainer') return c.institutionId === null || actor.institutionIds.includes(c.institutionId)
    if (actor.role === 'trainee') return c.courseStatus === 'published' && (await traineeHasSeatInProgramme(client, actor.userId, c.programmeId))
    return false
  }
  /** National programme content belongs to the super admin; institution content to that institution's admins and trainers. */
  function assertCanWrite(actor: AuthContext, c: Chain): void {
    if (actor.role === 'super_admin') return
    if ((actor.role === 'institution_admin' || actor.role === 'trainer') && c.institutionId !== null && actor.institutionIds.includes(c.institutionId)) return
    throw AppError.forbidden()
  }
  async function loadChain(client: Db | Tx, actor: AuthContext, kind: ChainKind, id: string, write = false): Promise<Chain> {
    const row = (await client.query(CHAIN_SQL[kind], [id])).rows[0] as Row | undefined
    const c: Chain | null = row ? { id: row.id as string, programmeId: row.programme_id as string, institutionId: (row.institution_id as string | null) ?? null, courseStatus: row.status as string, version: row.version as number } : null
    if (!c || !(await canRead(client, actor, c))) throw AppError.notFound(kind[0]!.toUpperCase() + kind.slice(1))
    if (write) {
      assertCanWrite(actor, c)
      if (c.institutionId) await assertInstitutionActive(client, c.institutionId)
    }
    return c
  }
  const audit = (tx: Tx, actor: AuthContext, info: ReqInfo, action: string, entityType: string, entityId: string, institutionId: string | null, changes?: Record<string, unknown>) =>
    writeAudit(tx, { ...auditBase(actor, info), action, entityType, entityId, institutionId, changes })

  // ------------------------------------------------------------ courses
  function courseVisibility(actor: AuthContext, params: unknown[]): string {
    if (actor.role === 'super_admin') return 'TRUE'
    if (actor.role === 'institution_admin' || actor.role === 'trainer') { params.push(actor.institutionIds); return `(p.institution_id IS NULL OR p.institution_id = ANY($${params.length}::uuid[]))` }
    if (actor.role === 'trainee') {
      params.push(actor.userId)
      return `(c.status = 'published' AND EXISTS (SELECT 1 FROM batch_enrolments e JOIN batches b ON b.id = e.batch_id AND b.deleted_at IS NULL JOIN trainees t ON t.id = e.trainee_id
        WHERE b.programme_id = c.programme_id AND t.user_id = $${params.length} AND t.deleted_at IS NULL AND e.status IN (${capacityStatusesSql()})))`
    }
    return 'FALSE'
  }
  async function listCourses(actor: AuthContext, f: CourseFilter, sort: ParsedSort, page: PageParams, lang?: string) {
    const params: unknown[] = []
    const where = ['c.deleted_at IS NULL', 'p.deleted_at IS NULL', courseVisibility(actor, params)]
    if (f.programmeId) { params.push(f.programmeId); where.push(`c.programme_id = $${params.length}::uuid`) }
    if (f.status) { params.push(f.status); where.push(`c.status = $${params.length}`) }
    if (f.q) { params.push(likePattern(f.q)); where.push(`c.title ILIKE $${params.length}`) }
    const res = await keysetList(db, { select: COURSE_COLS, from: COURSE_FROM, where, params, sort, idExpr: 'c.id', page, map: toCourseDto })
    const trs = await translationsFor(db, 'course', res.data.map((c) => c.id), lang)
    return { ...res, ...langMeta(lang), data: res.data.map((c) => overlayText(c, trs.get(c.id), TRANSLATABLE_FIELDS.course)) }
  }
  async function getCourse(actor: AuthContext, id: string, lang?: string) {
    await loadChain(db, actor, 'course', id)
    const r = await db.query(`SELECT ${COURSE_COLS} FROM ${COURSE_FROM} WHERE c.id = $1`, [id])
    const base = toCourseDto(r.rows[0] as Row)
    const tr = (await translationsFor(db, 'course', [id], lang)).get(id)
    return { ...overlayText(base, tr, TRANSLATABLE_FIELDS.course), ...langMeta(lang) }
  }
  async function createCourse(actor: AuthContext, input: { programmeId: string; title: string; description?: string | null; position?: number; status?: CourseStatus }, info: ReqInfo) {
    const id = await withTransaction(db, async (tx) => {
      const p = (await tx.query(`SELECT institution_id, status FROM programmes WHERE id = $1 AND deleted_at IS NULL`, [input.programmeId])).rows[0] as Row | undefined
      const chain: Chain | null = p ? { id: input.programmeId, programmeId: input.programmeId, institutionId: (p.institution_id as string | null) ?? null, courseStatus: 'draft', version: 1 } : null
      if (!chain || !(await canRead(tx, actor, { ...chain, courseStatus: 'published' }))) throw AppError.validation([{ path: 'programmeId', message: 'Programme not found' }])
      assertCanWrite(actor, chain)
      if (p!.status === 'archived') throw AppError.conflict('An archived programme cannot get new courses')
      if (chain.institutionId) await assertInstitutionActive(tx, chain.institutionId)
      const newId = ((await tx.query(`INSERT INTO courses (programme_id, title, description, position, status, created_at) VALUES ($1,$2,$3,$4,$5, now()) RETURNING id`,
        [input.programmeId, input.title.trim(), input.description ?? null, input.position ?? 0, input.status ?? 'draft'])).rows[0] as Row).id as string
      await audit(tx, actor, info, 'course.create', 'course', newId, chain.institutionId, { programmeId: input.programmeId, title: input.title })
      return newId
    })
    return getCourse(actor, id)
  }
  async function updateCourse(actor: AuthContext, id: string, patch: { title?: string; description?: string | null; position?: number; status?: CourseStatus }, expectedVersion: number, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const c = await loadChain(tx, actor, 'course', id, true)
      const q = buildUpdate({ table: 'courses', id, expectedVersion, returning: 'id', sets: { title: patch.title?.trim(), description: patch.description, position: patch.position, status: patch.status } })
      if (!(await tx.query(q.sql, q.params)).rows[0]) throw AppError.preconditionFailed()
      if (patch.status) await recomputeProgress(tx, c.programmeId)
      await audit(tx, actor, info, 'course.update', 'course', id, c.institutionId, { fields: Object.keys(patch).filter((k) => (patch as Row)[k] !== undefined) })
    })
    return getCourse(actor, id)
  }
  async function removeCourse(actor: AuthContext, id: string, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const c = await loadChain(tx, actor, 'course', id, true)
      await tx.query(`UPDATE lessons SET deleted_at = now() WHERE deleted_at IS NULL AND module_id IN (SELECT id FROM modules WHERE course_id = $1)`, [id])
      await tx.query(`UPDATE modules SET deleted_at = now() WHERE course_id = $1 AND deleted_at IS NULL`, [id])
      await tx.query(`UPDATE courses SET deleted_at = now() WHERE id = $1`, [id])
      await recomputeProgress(tx, c.programmeId)
      await audit(tx, actor, info, 'course.delete', 'course', id, c.institutionId)
    })
  }

  /** Course with its modules and lessons in order. Trainees also get their own lesson progress. */
  async function outline(actor: AuthContext, id: string, lang?: string) {
    await loadChain(db, actor, 'course', id)
    const course = await getCourse(actor, id, lang)
    const traineeId = actor.role === 'trainee' ? await traineeIdOfUser(db, actor.userId) : null
    const mods = (await db.query(`SELECT id, title, position, version FROM modules WHERE course_id = $1 AND deleted_at IS NULL ORDER BY position, created_at, id`, [id])).rows as Row[]
    const lessons = (await db.query(
      `SELECT l.id, l.module_id, l.title, l.lesson_type, l.content, l.duration_min, l.position, l.version, lp.status AS progress_status, lp.completed_at
       FROM lessons l JOIN modules m ON m.id = l.module_id LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.trainee_id = $2
       WHERE m.course_id = $1 AND m.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY l.position, l.created_at, l.id`, [id, traineeId])).rows as Row[]
    const modTr = await translationsFor(db, 'module', mods.map((m) => m.id as string), lang)
    const lesTr = await translationsFor(db, 'lesson', lessons.map((l) => l.id as string), lang)
    return {
      ...course,
      modules: mods.map((m) => overlayText({
        id: m.id as string, title: m.title as string, position: m.position as number, version: m.version as number,
        lessons: lessons.filter((l) => l.module_id === m.id).map((l) => overlayText({
          id: l.id as string, title: l.title as string, lessonType: l.lesson_type as LessonType, content: (l.content as string | null) ?? null,
          durationMin: (l.duration_min as number | null) ?? null, position: l.position as number, version: l.version as number,
          ...(traineeId ? { progress: (l.progress_status as string | null) ?? 'not_started', completedAt: (l.completed_at as Date | null) ?? null } : {}),   // progress belongs to the lesson, not a translation
        }, lesTr.get(l.id as string), TRANSLATABLE_FIELDS.lesson)),
      }, modTr.get(m.id as string), TRANSLATABLE_FIELDS.module)),
    }
  }

  // ------------------------------------------------------------ modules
  async function createModule(actor: AuthContext, input: { courseId: string; title: string; position?: number }, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const c = await loadChain(tx, actor, 'course', input.courseId, true)
      const r = (await tx.query(`INSERT INTO modules (course_id, title, position) VALUES ($1,$2,$3) RETURNING id, title, position, version`, [input.courseId, input.title.trim(), input.position ?? 0])).rows[0] as Row
      await audit(tx, actor, info, 'module.create', 'module', r.id as string, c.institutionId, { courseId: input.courseId })
      return { id: r.id as string, courseId: input.courseId, title: r.title as string, position: r.position as number, version: r.version as number }
    })
  }
  async function updateModule(actor: AuthContext, id: string, patch: { title?: string; position?: number }, expectedVersion: number, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const c = await loadChain(tx, actor, 'module', id, true)
      const q = buildUpdate({ table: 'modules', id, expectedVersion, returning: 'id, course_id, title, position, version', sets: { title: patch.title?.trim(), position: patch.position } })
      const r = (await tx.query(q.sql, q.params)).rows[0] as Row | undefined
      if (!r) throw AppError.preconditionFailed()
      await audit(tx, actor, info, 'module.update', 'module', id, c.institutionId, { fields: Object.keys(patch) })
      return { id, courseId: r.course_id as string, title: r.title as string, position: r.position as number, version: r.version as number }
    })
  }
  async function removeModule(actor: AuthContext, id: string, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const c = await loadChain(tx, actor, 'module', id, true)
      await tx.query(`UPDATE lessons SET deleted_at = now() WHERE module_id = $1 AND deleted_at IS NULL`, [id])
      await tx.query(`UPDATE modules SET deleted_at = now() WHERE id = $1`, [id])
      await recomputeProgress(tx, c.programmeId)
      await audit(tx, actor, info, 'module.delete', 'module', id, c.institutionId)
    })
  }

  // ------------------------------------------------------------ lessons
  const toLessonDto = (r: Row) => ({
    id: r.id as string, moduleId: r.module_id as string, title: r.title as string, lessonType: r.lesson_type as LessonType, content: (r.content as string | null) ?? null,
    durationMin: (r.duration_min as number | null) ?? null, position: r.position as number, version: r.version as number,
  })
  const LESSON_COLS = 'id, module_id, title, lesson_type, content, duration_min, position, version'
  async function createLesson(actor: AuthContext, input: { moduleId: string; title: string; lessonType?: LessonType; content?: string | null; durationMin?: number | null; position?: number }, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const c = await loadChain(tx, actor, 'module', input.moduleId, true)
      const r = (await tx.query(`INSERT INTO lessons (module_id, title, lesson_type, content, duration_min, position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${LESSON_COLS}`,
        [input.moduleId, input.title.trim(), input.lessonType ?? 'video', input.content ?? null, input.durationMin ?? null, input.position ?? 0])).rows[0] as Row
      await recomputeProgress(tx, c.programmeId)
      await audit(tx, actor, info, 'lesson.create', 'lesson', r.id as string, c.institutionId, { moduleId: input.moduleId })
      return toLessonDto(r)
    })
  }
  async function getLesson(actor: AuthContext, id: string, lang?: string) {
    await loadChain(db, actor, 'lesson', id)
    const base = toLessonDto((await db.query(`SELECT ${LESSON_COLS} FROM lessons WHERE id = $1`, [id])).rows[0] as Row)
    const tr = (await translationsFor(db, 'lesson', [id], lang)).get(id)
    return { ...overlayText(base, tr, TRANSLATABLE_FIELDS.lesson), ...langMeta(lang) }
  }

  // ------------------------------------------------------------ translations (write access = same rule as editing the item)
  const toTrDto = (r: Row) => ({ language: r.language as string, title: r.title as string, description: (r.description as string | null) ?? null, content: (r.content as string | null) ?? null, version: r.version as number, updatedAt: r.updated_at as Date })

  /** Languages this item has text for, including the default (the base text). Anyone who can read the item may see this list. */
  async function listTranslations(actor: AuthContext, kind: TranslatableKind, id: string) {
    await loadChain(db, actor, kind, id)
    const r = await db.query(`SELECT language, title, description, content, version, updated_at FROM content_translations WHERE entity_type = $1 AND entity_id = $2 ORDER BY language`, [kind, id])
    return { defaultLanguage: i18n.defaultLanguage, enabledLanguages: i18n.enabledLanguages, data: (r.rows as Row[]).map(toTrDto) }
  }
  /** Create or replace the text of one item in one language. Replacing an existing row needs its version (If-Match). */
  async function putTranslation(actor: AuthContext, kind: TranslatableKind, id: string, lang: string, input: TranslationInput, expectedVersion: number | undefined, info: ReqInfo) {
    assertEnabledLanguage(i18n, lang, 'language')
    if (lang === i18n.defaultLanguage) throw AppError.validation([{ path: 'language', message: `${lang} is the default language; edit the ${kind} itself` }])
    const allowed = TRANSLATABLE_FIELDS[kind]
    if ((input.description !== undefined && !allowed.includes('description')) || (input.content !== undefined && !allowed.includes('content')))
      throw AppError.validation([{ path: 'body', message: `A ${kind} translation may only contain: ${allowed.join(', ')}` }])
    const title = input.title.trim()
    if (title.length < 2) throw AppError.validation([{ path: 'title', message: 'Title must be at least 2 characters' }])
    await withTransaction(db, async (tx) => {
      const c = await loadChain(tx, actor, kind, id, true)
      const cur = (await tx.query(`SELECT id, version FROM content_translations WHERE entity_type = $1 AND entity_id = $2 AND language = $3 FOR UPDATE`, [kind, id, lang])).rows[0] as Row | undefined
      if (cur) {
        if (expectedVersion === undefined) throw AppError.badRequest('If-Match header with the current translation version is required to replace a translation')
        if ((cur.version as number) !== expectedVersion) throw AppError.preconditionFailed()
        await tx.query(`UPDATE content_translations SET title = $2, description = $3, content = $4, updated_by = $5 WHERE id = $1`, [cur.id, title, input.description ?? null, input.content ?? null, actor.userId])
      } else {
        await tx.query(`INSERT INTO content_translations (entity_type, entity_id, language, title, description, content, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [kind, id, lang, title, input.description ?? null, input.content ?? null, actor.userId])
      }
      await audit(tx, actor, info, cur ? 'translation.update' : 'translation.create', kind, id, c.institutionId, { language: lang })
    })
    const r = await db.query(`SELECT language, title, description, content, version, updated_at FROM content_translations WHERE entity_type = $1 AND entity_id = $2 AND language = $3`, [kind, id, lang])
    return toTrDto(r.rows[0] as Row)
  }
  async function removeTranslation(actor: AuthContext, kind: TranslatableKind, id: string, lang: string, info: ReqInfo) {
    assertEnabledLanguage(i18n, lang, 'language')
    await withTransaction(db, async (tx) => {
      const c = await loadChain(tx, actor, kind, id, true)
      const r = await tx.query(`DELETE FROM content_translations WHERE entity_type = $1 AND entity_id = $2 AND language = $3 RETURNING id`, [kind, id, lang])
      if (!r.rows[0]) throw AppError.notFound('Translation')
      await audit(tx, actor, info, 'translation.delete', kind, id, c.institutionId, { language: lang })
    })
  }
  async function updateLesson(actor: AuthContext, id: string, patch: { title?: string; lessonType?: LessonType; content?: string | null; durationMin?: number | null; position?: number }, expectedVersion: number, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const c = await loadChain(tx, actor, 'lesson', id, true)
      const q = buildUpdate({ table: 'lessons', id, expectedVersion, returning: LESSON_COLS,
        sets: { title: patch.title?.trim(), lesson_type: patch.lessonType, content: patch.content, duration_min: patch.durationMin, position: patch.position } })
      const r = (await tx.query(q.sql, q.params)).rows[0] as Row | undefined
      if (!r) throw AppError.preconditionFailed()
      await audit(tx, actor, info, 'lesson.update', 'lesson', id, c.institutionId, { fields: Object.keys(patch) })
      return toLessonDto(r)
    })
  }
  async function removeLesson(actor: AuthContext, id: string, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const c = await loadChain(tx, actor, 'lesson', id, true)
      await tx.query(`UPDATE lessons SET deleted_at = now() WHERE id = $1`, [id])
      await recomputeProgress(tx, c.programmeId)
      await audit(tx, actor, info, 'lesson.delete', 'lesson', id, c.institutionId)
    })
  }
  /** A trainee marks a lesson in_progress or completed. Progress on their enrolments is recalculated in the same transaction. */
  async function setLessonProgress(actor: AuthContext, lessonId: string, status: 'in_progress' | 'completed') {
    return withTransaction(db, async (tx) => {
      const c = await loadChain(tx, actor, 'lesson', lessonId)      // trainees only pass for published courses they hold a seat in
      const traineeId = await traineeIdOfUser(tx, actor.userId)
      if (!traineeId) throw AppError.forbidden('Only trainees record lesson progress')
      const r = (await tx.query(
        `INSERT INTO lesson_progress (lesson_id, trainee_id, status, completed_at) VALUES ($1,$2,$3::text, CASE WHEN $3::text = 'completed' THEN now() END)
         ON CONFLICT (lesson_id, trainee_id) DO UPDATE SET status = EXCLUDED.status,
           completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN COALESCE(lesson_progress.completed_at, now()) END, updated_at = now()
         RETURNING lesson_id, status, completed_at`, [lessonId, traineeId, status])).rows[0] as Row
      await recomputeProgress(tx, c.programmeId, traineeId)
      return { lessonId: r.lesson_id as string, status: r.status as string, completedAt: (r.completed_at as Date | null) ?? null }
    })
  }

  // ------------------------------------------------------------ resources (external links only until Part 7 adds file storage)
  async function assertResourceTarget(client: Db | Tx, actor: AuthContext, t: ResourceTarget, write: boolean): Promise<string | null> {
    if (t.courseId) return (await loadChain(client, actor, 'course', t.courseId, write)).institutionId
    if (t.lessonId) return (await loadChain(client, actor, 'lesson', t.lessonId, write)).institutionId
    if (t.batchId) return (await loadBatch(client, actor, t.batchId, write ? 'teach' : 'read')).institutionId
    throw AppError.validation([{ path: 'target', message: 'Provide exactly one of courseId, lessonId, batchId' }])
  }
  async function loadResource(client: Db | Tx, id: string): Promise<Row> {
    const r = (await client.query(`SELECT ${RESOURCE_COLS} FROM resources r WHERE r.id = $1 AND r.deleted_at IS NULL`, [id])).rows[0] as Row | undefined
    if (!r) throw AppError.notFound('Resource')
    return r
  }
  const targetOf = (r: Row): ResourceTarget => ({ courseId: (r.course_id as string | null) ?? undefined, lessonId: (r.lesson_id as string | null) ?? undefined, batchId: (r.batch_id as string | null) ?? undefined })

  async function listResources(actor: AuthContext, t: ResourceTarget, sort: ParsedSort, page: PageParams) {
    await assertResourceTarget(db, actor, t, false)
    const col = t.courseId ? 'course_id' : t.lessonId ? 'lesson_id' : 'batch_id'
    return keysetList(db, { select: RESOURCE_COLS, from: 'resources r', where: ['r.deleted_at IS NULL', `r.${col} = $1::uuid`], params: [t.courseId ?? t.lessonId ?? t.batchId], sort, idExpr: 'r.id', page, map: toResourceDto })
  }
  async function getResource(actor: AuthContext, id: string) {
    const r = await loadResource(db, id)
    try { await assertResourceTarget(db, actor, targetOf(r), false) } catch { throw AppError.notFound('Resource') }
    return toResourceDto(r)
  }
  async function createResource(actor: AuthContext, input: ResourceTarget & { title: string; description?: string | null; resourceType?: ResourceType; externalUrl: string }, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const institutionId = await assertResourceTarget(tx, actor, input, true)
      const r = (await tx.query(
        `INSERT INTO resources (title, description, resource_type, external_url, course_id, lesson_id, batch_id, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${RESOURCE_COLS.replace(/r\./g, '')}`,
        [input.title.trim(), input.description ?? null, input.resourceType ?? 'link', input.externalUrl, input.courseId ?? null, input.lessonId ?? null, input.batchId ?? null, actor.userId])).rows[0] as Row
      await audit(tx, actor, info, 'resource.create', 'resource', r.id as string, institutionId, { title: input.title })
      return toResourceDto(r)
    })
  }
  async function updateResource(actor: AuthContext, id: string, patch: { title?: string; description?: string | null; resourceType?: ResourceType; externalUrl?: string }, expectedVersion: number, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const cur = await loadResource(tx, id)
      let institutionId: string | null
      try { institutionId = await assertResourceTarget(tx, actor, targetOf(cur), true) } catch (e) { if (e instanceof AppError && e.statusCode === 404) throw AppError.notFound('Resource'); throw e }
      const q = buildUpdate({ table: 'resources', id, expectedVersion, returning: RESOURCE_COLS.replace(/r\./g, ''), sets: { title: patch.title?.trim(), description: patch.description, resource_type: patch.resourceType, external_url: patch.externalUrl } })
      const r = (await tx.query(q.sql, q.params)).rows[0] as Row | undefined
      if (!r) throw AppError.preconditionFailed()
      await audit(tx, actor, info, 'resource.update', 'resource', id, institutionId, { fields: Object.keys(patch) })
      return toResourceDto(r)
    })
  }
  async function removeResource(actor: AuthContext, id: string, info: ReqInfo) {
    await withTransaction(db, async (tx) => {
      const cur = await loadResource(tx, id)
      let institutionId: string | null
      try { institutionId = await assertResourceTarget(tx, actor, targetOf(cur), true) } catch (e) { if (e instanceof AppError && e.statusCode === 404) throw AppError.notFound('Resource'); throw e }
      await tx.query(`UPDATE resources SET deleted_at = now() WHERE id = $1`, [id])
      await audit(tx, actor, info, 'resource.delete', 'resource', id, institutionId)
    })
  }

  return {
    listCourses, getCourse, createCourse, updateCourse, removeCourse, outline,
    createModule, updateModule, removeModule,
    createLesson, getLesson, updateLesson, removeLesson, setLessonProgress,
    listTranslations, putTranslation, removeTranslation,
    listResources, getResource, createResource, updateResource, removeResource,
  }
}
export type LmsService = ReturnType<typeof createLmsService>
