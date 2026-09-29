import type { Db } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { scopeInstitutionIds, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { capacityStatusesSql } from '../training/constants.js'
import { auditBase, batchVisibilitySql, loadBatch, traineeIdOfUser, type Row } from './access.js'
import { attendancePercent, planSelfCheckIn, SELF_CHECKIN_METHODS, STAFF_MARK_METHODS, type AttendanceMethod, type AttendanceStatus } from './attendance.rules.js'
import type { AppConfig } from '../../config/env.js'
import { issueQrToken, newQrSecret, verifyQrToken } from './attendance.qr.js'
import { assertNoSimulationInProduction, noFaceProvider, pickFaceProvider, pickFingerprintProvider, type FaceProvider, type FingerprintProvider, type Verification } from './biometric.js'

export interface AttendanceRecordInput { traineeId: string; status: AttendanceStatus; method?: AttendanceMethod; checkedInAt?: string | null; notes?: string | null }
export interface AttendanceFilter { sessionId?: string; batchId?: string; traineeId?: string; status?: AttendanceStatus; from?: string; to?: string; institutionId?: string }

const COLS = `a.id, a.session_id, s.title AS session_title, s.starts_at, s.batch_id, b.code AS batch_code, a.trainee_id, u.full_name AS trainee_name,
  a.status, a.method, a.verification, a.checked_in_at, a.notes, a.version, a.created_at`
const FROM = `attendance a JOIN class_sessions s ON s.id = a.session_id JOIN batches b ON b.id = s.batch_id LEFT JOIN trainers tr ON tr.id = b.trainer_id
  JOIN trainees t ON t.id = a.trainee_id JOIN users u ON u.id = t.user_id`
const toDto = (r: Row) => ({
  id: r.id as string, sessionId: r.session_id as string, sessionTitle: r.session_title as string, startsAt: r.starts_at as Date, batchId: r.batch_id as string, batchCode: r.batch_code as string,
  traineeId: r.trainee_id as string, traineeName: r.trainee_name as string, status: r.status as AttendanceStatus, method: r.method as AttendanceMethod, verification: (r.verification as string | null) ?? null,
  checkedInAt: (r.checked_in_at as Date | null) ?? null, notes: (r.notes as string | null) ?? null, version: r.version as number, createdAt: r.created_at as Date,
})
const MAX_BULK = 500

export interface AttendanceDeps { config: Pick<AppConfig, 'env' | 'features'>; fingerprint?: FingerprintProvider; face?: FaceProvider }

export function createAttendanceService(db: Db, deps: AttendanceDeps) {
  const { config } = deps
  const fingerprintProvider = pickFingerprintProvider(config.env, config.features, deps.fingerprint)
  const faceProvider = deps.face ?? pickFaceProvider(config.env, config.features)
  async function list(actor: AuthContext, f: AttendanceFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = ['b.deleted_at IS NULL', 't.deleted_at IS NULL', batchVisibilitySql(actor, params)]
    if (actor.role === 'trainee') { params.push(actor.userId); where.push(`t.user_id = $${params.length}`) }     // trainees never see classmates
    if (f.institutionId) { const ids = scopeInstitutionIds(actor, f.institutionId); if (ids) { params.push(ids); where.push(`b.institution_id = ANY($${params.length}::uuid[])`) } }
    if (f.sessionId) { params.push(f.sessionId); where.push(`a.session_id = $${params.length}::uuid`) }
    if (f.batchId) { params.push(f.batchId); where.push(`s.batch_id = $${params.length}::uuid`) }
    if (f.traineeId) { params.push(f.traineeId); where.push(`a.trainee_id = $${params.length}::uuid`) }
    if (f.status) { params.push(f.status); where.push(`a.status = $${params.length}`) }
    if (f.from) { params.push(f.from); where.push(`s.starts_at >= $${params.length}::timestamptz`) }
    if (f.to) { params.push(f.to); where.push(`s.starts_at < $${params.length}::timestamptz`) }
    return keysetList(db, { select: COLS, from: FROM, where, params, sort, idExpr: 'a.id', page, map: toDto })
  }

  async function sessionRow(client: Db | import('../../db/pool.js').Tx, sessionId: string): Promise<Row> {
    const r = (await client.query(`SELECT id, batch_id, status, starts_at, ends_at, mode, attendance_opened_at, attendance_opened_by, attendance_closed_at, qr_secret FROM class_sessions WHERE id = $1`, [sessionId])).rows[0] as Row | undefined
    if (!r) throw AppError.notFound('Session')
    return r
  }

  /** Trainer (own batch) or super admin marks a whole session in one call. Re-sending a trainee corrects their record. */
  async function markBulk(actor: AuthContext, sessionId: string, records: AttendanceRecordInput[], info: ReqInfo) {
    if (records.length === 0 || records.length > MAX_BULK) throw AppError.validation([{ path: 'records', message: `Send between 1 and ${MAX_BULK} records` }])
    if (new Set(records.map((r) => r.traineeId)).size !== records.length) throw AppError.validation([{ path: 'records', message: 'Each trainee may appear only once' }])
    if (records.some((r) => r.method && !STAFF_MARK_METHODS.includes(r.method))) throw AppError.validation([{ path: 'records.method', message: `Staff can record: ${STAFF_MARK_METHODS.join(', ')}. QR, fingerprint and face are recorded only by verification.` }])
    await withTransaction(db, async (tx) => {
      const s = await sessionRow(tx, sessionId)
      const batch = await loadBatch(tx, actor, s.batch_id as string, 'teach')
      if (actor.role === 'institution_admin') throw AppError.forbidden()
      if (s.status === 'cancelled') throw AppError.conflict('Attendance cannot be marked for a cancelled session')
      const ok = (await tx.query(`SELECT trainee_id FROM batch_enrolments WHERE batch_id = $1 AND trainee_id = ANY($2::uuid[]) AND status IN (${capacityStatusesSql()})`, [batch.id, records.map((r) => r.traineeId)])).rows as Row[]
      const okIds = new Set(ok.map((r) => r.trainee_id as string))
      const unknown = records.filter((r) => !okIds.has(r.traineeId)).map((r) => r.traineeId)
      if (unknown.length) throw AppError.validation([{ path: 'records', message: 'Some trainees do not hold a seat in this batch' }])
      for (const rec of records) {
        await tx.query(
          `INSERT INTO attendance (session_id, trainee_id, status, method, checked_in_at, marked_by, notes)
           VALUES ($1,$2,$3::text,$4,CASE WHEN $3::text IN ('present','late') THEN COALESCE($5::timestamptz, now()) END,$6,$7)
           ON CONFLICT (session_id, trainee_id) DO UPDATE SET status = EXCLUDED.status, method = EXCLUDED.method, marked_by = EXCLUDED.marked_by, notes = EXCLUDED.notes,
             checked_in_at = CASE WHEN EXCLUDED.status IN ('present','late') THEN COALESCE($5::timestamptz, attendance.checked_in_at, now()) END`,
          [sessionId, rec.traineeId, rec.status, rec.method ?? 'manual', rec.checkedInAt ?? null, actor.userId, rec.notes ?? null])
      }
      const counts: Record<string, number> = {}
      for (const r of records) counts[r.status] = (counts[r.status] ?? 0) + 1
      await writeAudit(tx, { ...auditBase(actor, info), action: 'attendance.mark', entityType: 'class_session', entityId: sessionId, institutionId: batch.institutionId, changes: { records: records.length, counts } })
    })
    return list(actor, { sessionId }, { key: 'created_at', expr: 'a.created_at', type: 'timestamptz', dir: 'ASC' }, { limit: MAX_BULK })
  }

  type Ctx = { s: Row; traineeId: string }
  /**
   * Shared trainee-side recorder. Order matters: scope (404 for outsiders) -> active seat -> session state -> optional attendance-open
   * requirement -> proof (`prove`, only reached by members) -> time window -> insert. One row per trainee per session (DB unique),
   * and it never overwrites a record a trainer already made. Allowed from 15 minutes before the start until the end; late after +15 min.
   */
  async function recordSelf(actor: AuthContext, sessionId: string, method: AttendanceMethod, info: ReqInfo, now: number,
    opts: { requireOpen: boolean; prove?: (c: Ctx) => Promise<Verification | null> }) {
    const id = await withTransaction(db, async (tx) => {
      const traineeId = await traineeIdOfUser(tx, actor.userId)
      if (!traineeId) throw AppError.forbidden('Only trainees can check in')
      const s = await sessionRow(tx, sessionId)
      const batch = await loadBatch(tx, actor, s.batch_id as string, 'read')              // 404 unless they hold a seat
      const active = await tx.query(`SELECT 1 FROM batch_enrolments WHERE batch_id = $1 AND trainee_id = $2 AND status IN ('enrolled','in_progress')`, [batch.id, traineeId])
      if (!active.rows[0]) throw AppError.conflict('Only active enrolments can check in')
      if (s.status === 'cancelled' || s.status === 'completed') throw AppError.conflict(`This session is ${String(s.status)}`)
      if (opts.requireOpen && !(s.attendance_opened_at && !s.attendance_closed_at)) throw AppError.conflict('Attendance is not open for this session', { code: 'ATTENDANCE_CLOSED' })
      const verification = opts.prove ? await opts.prove({ s, traineeId }) : null
      const status = planSelfCheckIn((s.starts_at as Date).getTime(), (s.ends_at as Date).getTime(), now)
      const r = await tx.query(
        `INSERT INTO attendance (session_id, trainee_id, status, method, verification, checked_in_at, marked_by) VALUES ($1,$2,$3,$4,$5,now(),$6)
         ON CONFLICT (session_id, trainee_id) DO NOTHING RETURNING id`, [sessionId, traineeId, status, method, verification, actor.userId])
      if (!r.rows[0]) throw AppError.conflict('Attendance is already recorded for this session', { code: 'ATTENDANCE_DUPLICATE' })
      await writeAudit(tx, { ...auditBase(actor, info), action: 'attendance.checkin', entityType: 'class_session', entityId: sessionId, institutionId: batch.institutionId, changes: { status, method, verification } })
      return (r.rows[0] as Row).id as string
    })
    const res = await list(actor, { sessionId }, { key: 'created_at', expr: 'a.created_at', type: 'timestamptz', dir: 'ASC' }, { limit: 1 })
    return res.data.find((d) => d.id === id) ?? res.data[0]!
  }

  /** Plain (unverified) check-in: manual or online only. */
  async function selfCheckIn(actor: AuthContext, sessionId: string, method: AttendanceMethod | undefined, info: ReqInfo, now: number = Date.now()) {
    if (method && !SELF_CHECKIN_METHODS.includes(method)) throw AppError.validation([{ path: 'method', message: `Plain check-in supports: ${SELF_CHECKIN_METHODS.join(', ')}. Use the QR / fingerprint / face verification endpoints for those.` }])
    const mode = (await sessionRow(db, sessionId)).mode
    return recordSelf(actor, sessionId, method ?? (mode === 'online' ? 'online' : 'manual'), info, now, { requireOpen: false })
  }

  // ------------------------------------------------------------ attendance session (who opened it) and QR
  const staffSession = async (tx: Db | import('../../db/pool.js').Tx, actor: AuthContext, sessionId: string, lock = false) => {
    const s = await sessionRow(tx, sessionId)
    const batch = await loadBatch(tx, actor, s.batch_id as string, 'teach', lock)
    if (actor.role === 'institution_admin') throw AppError.forbidden()
    return { s, batch }
  }
  const stateOf = (s: Row) => ({
    sessionId: s.id as string, open: Boolean(s.attendance_opened_at) && !s.attendance_closed_at,
    openedAt: (s.attendance_opened_at as Date | null) ?? null, openedBy: (s.attendance_opened_by as string | null) ?? null, closedAt: (s.attendance_closed_at as Date | null) ?? null,
  })

  /** Trainer (own batch) or super admin starts attendance for a session. Idempotent while open; reopening after a close issues a new QR secret. */
  async function openAttendance(actor: AuthContext, sessionId: string, info: ReqInfo, now: number = Date.now()) {
    return withTransaction(db, async (tx) => {
      const { batch } = await staffSession(tx, actor, sessionId, true)
      const s = (await tx.query(`SELECT id, status, ends_at, attendance_opened_at, attendance_opened_by, attendance_closed_at FROM class_sessions WHERE id = $1 FOR UPDATE`, [sessionId])).rows[0] as Row
      if (s.status === 'cancelled' || s.status === 'completed') throw AppError.conflict(`This session is ${String(s.status)}`)
      if (now >= (s.ends_at as Date).getTime()) throw AppError.conflict('This session has ended; mark attendance manually')
      if (s.attendance_opened_at && !s.attendance_closed_at) return stateOf(s)
      const u = (await tx.query(
        `UPDATE class_sessions SET attendance_opened_at = now(), attendance_opened_by = $2, attendance_closed_at = NULL, attendance_closed_by = NULL, qr_secret = $3
         WHERE id = $1 RETURNING id, attendance_opened_at, attendance_opened_by, attendance_closed_at`, [sessionId, actor.userId, newQrSecret()])).rows[0] as Row
      await writeAudit(tx, { ...auditBase(actor, info), action: 'attendance.open', entityType: 'class_session', entityId: sessionId, institutionId: batch.institutionId })
      return stateOf(u)
    })
  }
  async function closeAttendance(actor: AuthContext, sessionId: string, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const { batch } = await staffSession(tx, actor, sessionId, true)
      const s = (await tx.query(`SELECT id, attendance_opened_at, attendance_opened_by, attendance_closed_at FROM class_sessions WHERE id = $1 FOR UPDATE`, [sessionId])).rows[0] as Row
      if (!s.attendance_opened_at || s.attendance_closed_at) return stateOf(s)
      const u = (await tx.query(
        `UPDATE class_sessions SET attendance_closed_at = now(), attendance_closed_by = $2, qr_secret = NULL WHERE id = $1
         RETURNING id, attendance_opened_at, attendance_opened_by, attendance_closed_at`, [sessionId, actor.userId])).rows[0] as Row
      await writeAudit(tx, { ...auditBase(actor, info), action: 'attendance.close', entityType: 'class_session', entityId: sessionId, institutionId: batch.institutionId })
      return stateOf(u)
    })
  }
  async function attendanceState(actor: AuthContext, sessionId: string) {
    const s = await sessionRow(db, sessionId)
    await loadBatch(db, actor, s.batch_id as string, 'read')
    return stateOf(s)
  }

  function assertQrEnabled() { if (!config.features.qrAttendance) throw AppError.unavailable('QR attendance is disabled; use manual attendance') }

  /** A fresh short-lived token for the trainer screen to render as a QR code. Poll before `expiresAt`. Not audited (read, high volume). */
  async function currentQr(actor: AuthContext, sessionId: string, now: number = Date.now()) {
    assertQrEnabled()
    const { s } = await staffSession(db, actor, sessionId)
    if (!s.attendance_opened_at || s.attendance_closed_at || !s.qr_secret) throw AppError.conflict('Attendance is not open for this session', { code: 'ATTENDANCE_CLOSED' })
    return { sessionId, ...issueQrToken(s.qr_secret as string, sessionId, now) }
  }
  async function verifyQr(actor: AuthContext, sessionId: string, token: string, info: ReqInfo, now: number = Date.now()) {
    assertQrEnabled()
    return recordSelf(actor, sessionId, 'qr', info, now, {
      requireOpen: true,
      prove: async ({ s }) => { verifyQrToken(token, s.qr_secret as string, sessionId, now); return 'qr_token' },
    })
  }

  // ------------------------------------------------------------ fingerprint (provider abstraction) and face (optional)
  async function verifyFingerprint(actor: AuthContext, sessionId: string, body: { simulatedKey?: string; deviceProof?: string }, info: ReqInfo, now: number = Date.now()) {
    assertNoSimulationInProduction(config.env, body)
    return recordSelf(actor, sessionId, 'fingerprint', info, now, {
      requireOpen: true,
      prove: async ({ traineeId }) => {
        const r = await fingerprintProvider.verify({ traineeId, sessionId, ...body })
        if (!r.ok) throw AppError.forbidden('Fingerprint verification failed')
        return r.verification
      },
    })
  }
  async function verifyFace(actor: AuthContext, sessionId: string, body: { proof?: string }, info: ReqInfo, now: number = Date.now()) {
    if (!config.features.faceAttendance || !faceProvider.available) throw AppError.unavailable('Face verification is not available; use QR or ask your trainer to mark attendance')
    return recordSelf(actor, sessionId, 'face', info, now, {
      requireOpen: true,
      prove: async ({ traineeId }) => {
        const r = await faceProvider.verify({ traineeId, sessionId, ...body })
        if (!r.ok) throw AppError.forbidden('Face verification failed')
        return r.verification
      },
    })
  }

  /** What the UI may offer right now (Part 9 hides everything not listed as available). The Space bypass is offered only when `simulated` is true. */
  function methods() {
    return {
      manual: { available: true }, online: { available: true },
      qr: { available: config.features.qrAttendance, ttlSeconds: 30 },
      fingerprint: { available: fingerprintProvider.name !== 'none', simulated: fingerprintProvider.name === 'simulated-space-key' },
      face: { available: config.features.faceAttendance && faceProvider.available },
    }
  }

  /** Per-trainee attendance for a batch (see attendancePercent for the formula). Trainees receive only their own row. */
  async function summary(actor: AuthContext, batchId: string, traineeId?: string) {
    const batch = await loadBatch(db, actor, batchId, 'read')
    let only = traineeId ?? null
    if (actor.role === 'trainee') only = await traineeIdOfUser(db, actor.userId)
    const r = await db.query(
      `WITH counted AS (SELECT id FROM class_sessions WHERE batch_id = $1 AND status <> 'cancelled' AND (status = 'completed' OR ends_at <= now()))
       SELECT e.trainee_id, u.full_name AS trainee_name, (SELECT count(*)::int FROM counted) AS counted,
              count(a.id) FILTER (WHERE a.status = 'present')::int AS present, count(a.id) FILTER (WHERE a.status = 'late')::int AS late,
              count(a.id) FILTER (WHERE a.status = 'excused')::int AS excused
       FROM batch_enrolments e JOIN trainees t ON t.id = e.trainee_id JOIN users u ON u.id = t.user_id
       LEFT JOIN attendance a ON a.trainee_id = e.trainee_id AND a.session_id IN (SELECT id FROM counted)
       WHERE e.batch_id = $1 AND t.deleted_at IS NULL AND e.status IN (${capacityStatusesSql()}) AND ($2::uuid IS NULL OR e.trainee_id = $2::uuid)
       GROUP BY e.trainee_id, u.full_name ORDER BY u.full_name, e.trainee_id`, [batch.id, only])
    return {
      batchId: batch.id, batchCode: batch.code,
      data: (r.rows as Row[]).map((x) => {
        const counted = x.counted as number, present = x.present as number, late = x.late as number, excused = x.excused as number
        return { traineeId: x.trainee_id as string, traineeName: x.trainee_name as string, sessionsCounted: counted, present, late, excused,
          absent: Math.max(counted - present - late - excused, 0), attendancePercent: attendancePercent({ present, late, absent: 0, excused, counted }) }
      }),
    }
  }

  return { list, markBulk, selfCheckIn, summary, openAttendance, closeAttendance, attendanceState, currentQr, verifyQr, verifyFingerprint, verifyFace, methods }
}
export type AttendanceService = ReturnType<typeof createAttendanceService>
