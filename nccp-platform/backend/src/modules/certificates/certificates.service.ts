import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { writeAudit } from '../../audit/audit.js'
import { assertInstitutionAccess, scopeInstitutionIds, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'
import { auditBase, type Row } from '../learning/access.js'
import {
  CERT_ONE_LIVE_INDEX, CERT_UNIQUE_CODE_CONSTRAINT, CERT_UNIQUE_NO_CONSTRAINT, SETTING_KEYS, evaluateEligibility, generateCertificateNo, generateVerificationCode,
  isWinAnsiPrintable, normaliseVerificationCode, parseCertificateSettings, publicHolderName, type CertificateSettings, type EligibilityResult,
} from './certificates.rules.js'
import { shapeCertificate, toPublicVerification, type CertificateRecord } from './certificates.dto.js'
import { printedFields, renderCertificatePdf } from './certificate.pdf.js'

export interface CertificateFilter { traineeId?: string; enrolmentId?: string; programmeId?: string; institutionId?: string; status?: 'issued' | 'revoked'; q?: string }

const COLS = `c.id, c.certificate_no, c.verification_code, c.trainee_id, c.enrolment_id, c.programme_id, c.institution_id, c.title, c.holder_name,
  c.grade, c.score::float8 AS score, c.status, c.issued_at, c.revoked_at, c.revocation_reason, c.version`
// batch + trainer + trainee joins exist only so role visibility can be expressed in one place
const FROM = `certificates c JOIN batch_enrolments e ON e.id = c.enrolment_id JOIN batches b ON b.id = e.batch_id
  LEFT JOIN trainers tr ON tr.id = b.trainer_id JOIN trainees t ON t.id = c.trainee_id`

const toRecord = (r: Row): CertificateRecord => ({
  id: r.id as string, certificateNo: r.certificate_no as string, verificationCode: r.verification_code as string, traineeId: r.trainee_id as string,
  enrolmentId: r.enrolment_id as string, programmeId: r.programme_id as string, institutionId: (r.institution_id as string | null) ?? null,
  title: r.title as string, holderName: r.holder_name as string, grade: (r.grade as string | null) ?? null, score: (r.score as number | null) ?? null,
  status: r.status as 'issued' | 'revoked', issuedAt: r.issued_at as Date, revokedAt: (r.revoked_at as Date | null) ?? null,
  revocationReason: (r.revocation_reason as string | null) ?? null, version: r.version as number,
})

interface EnrolmentInfo {
  id: string; status: string; finalScore: number | null; batchId: string; batchCode: string; institutionId: string; programmeId: string; programmeTitle: string
  traineeId: string; traineeUserId: string; trainerUserId: string | null; traineeName: string
}
const pgConstraint = (err: unknown): string | undefined => {
  const e = err as { code?: string; constraint?: string }
  return e?.code === '23505' ? e.constraint : undefined
}

export interface CertificatesServiceOptions { /** Base URL of the web app; the PDF prints `${appBaseUrl}/verify/<code>`. */ appBaseUrl?: string }

export function createCertificatesService(db: Db, opts: CertificatesServiceOptions = {}) {
  const appBaseUrl = (opts.appBaseUrl ?? 'http://localhost:3000').replace(/\/+$/, '')
  /** Role visibility as a SQL predicate on the aliases in FROM. Employers see a certificate only if its holder applied to one of their jobs. */
  function visibility(actor: AuthContext, params: unknown[]): string {
    if (actor.role === 'super_admin') return 'TRUE'
    if (actor.role === 'institution_admin') { params.push(actor.institutionIds); return `c.institution_id = ANY($${params.length}::uuid[])` }
    if (actor.role === 'trainer') { params.push(actor.userId); return `tr.user_id = $${params.length}` }
    if (actor.role === 'trainee') { params.push(actor.userId); return `t.user_id = $${params.length}` }
    if (actor.role === 'employer') {
      params.push(actor.employerIds)
      return `EXISTS (SELECT 1 FROM applications a JOIN jobs j ON j.id = a.job_id
                       WHERE a.trainee_id = c.trainee_id AND j.employer_id = ANY($${params.length}::uuid[]) AND a.status <> 'withdrawn' AND j.deleted_at IS NULL)`
    }
    return 'FALSE'
  }

  async function loadSettings(client: Db | Tx = db): Promise<CertificateSettings> {
    const r = await client.query(`SELECT key, value FROM system_settings WHERE key = ANY($1::text[])`, [Object.values(SETTING_KEYS)])
    return parseCertificateSettings(Object.fromEntries((r.rows as Row[]).map((x) => [x.key as string, x.value])))
  }

  /** Enrolment the caller may act on, or 404. Read access: admins in scope, the batch trainer, the trainee themself. Employers never. */
  async function loadEnrolment(client: Db | Tx, actor: AuthContext, id: string, lock = false): Promise<EnrolmentInfo> {
    const r = await client.query(
      `SELECT e.id, e.status, e.final_score::float8 AS final_score, e.batch_id, b.code AS batch_code, b.institution_id, b.programme_id, p.title AS programme_title,
              e.trainee_id, t.user_id AS trainee_user_id, tr.user_id AS trainer_user_id, u.full_name AS trainee_name
         FROM batch_enrolments e JOIN batches b ON b.id = e.batch_id AND b.deleted_at IS NULL JOIN programmes p ON p.id = b.programme_id
         JOIN trainees t ON t.id = e.trainee_id AND t.deleted_at IS NULL JOIN users u ON u.id = t.user_id LEFT JOIN trainers tr ON tr.id = b.trainer_id
        WHERE e.id = $1${lock ? ' FOR UPDATE OF e' : ''}`, [id])
    const x = r.rows[0] as Row | undefined
    if (!x) throw AppError.notFound('Enrolment')
    const info: EnrolmentInfo = {
      id: x.id as string, status: x.status as string, finalScore: (x.final_score as number | null) ?? null, batchId: x.batch_id as string, batchCode: x.batch_code as string,
      institutionId: x.institution_id as string, programmeId: x.programme_id as string, programmeTitle: x.programme_title as string, traineeId: x.trainee_id as string,
      traineeUserId: x.trainee_user_id as string, trainerUserId: (x.trainer_user_id as string | null) ?? null, traineeName: x.trainee_name as string,
    }
    const visible = actor.role === 'super_admin' ? true
      : actor.role === 'institution_admin' ? actor.institutionIds.includes(info.institutionId)
      : actor.role === 'trainer' ? info.trainerUserId === actor.userId
      : actor.role === 'trainee' ? info.traineeUserId === actor.userId
      : false
    if (!visible) throw AppError.notFound('Enrolment')
    return info
  }

  /**
   * The numbers behind eligibility, computed with the same predicates as GET /attendance/summary and GET /assessments/summary
   * (finished non-cancelled sessions; published/closed assessments passed once graded). Keep the three in step if either changes.
   */
  async function loadInputs(client: Db | Tx, e: EnrolmentInfo) {
    const r = await client.query(
      `WITH counted AS (SELECT id FROM class_sessions WHERE batch_id = $1 AND status <> 'cancelled' AND (status = 'completed' OR ends_at <= now())),
            pub AS (SELECT id FROM assessments WHERE batch_id = $1 AND status IN ('published','closed') AND deleted_at IS NULL)
       SELECT (SELECT count(*)::int FROM counted) AS counted,
              (SELECT count(*)::int FROM attendance a WHERE a.trainee_id = $2 AND a.session_id IN (SELECT id FROM counted) AND a.status = 'present') AS present,
              (SELECT count(*)::int FROM attendance a WHERE a.trainee_id = $2 AND a.session_id IN (SELECT id FROM counted) AND a.status = 'late') AS late,
              (SELECT count(*)::int FROM attendance a WHERE a.trainee_id = $2 AND a.session_id IN (SELECT id FROM counted) AND a.status = 'excused') AS excused,
              (SELECT count(*)::int FROM pub) AS total,
              (SELECT count(DISTINCT r.assessment_id)::int FROM assessment_results r WHERE r.trainee_id = $2 AND r.status = 'graded' AND r.passed IS TRUE AND r.assessment_id IN (SELECT id FROM pub)) AS passed`,
      [e.batchId, e.traineeId])
    const x = r.rows[0] as Row
    const counted = x.counted as number, present = x.present as number, late = x.late as number, excused = x.excused as number
    return {
      enrolmentStatus: e.status,
      attendance: { present, late, excused, absent: Math.max(counted - present - late - excused, 0), counted },
      assessments: { total: x.total as number, passed: x.passed as number },
    }
  }

  async function evaluate(client: Db | Tx, e: EnrolmentInfo): Promise<EligibilityResult> {
    return evaluateEligibility(await loadInputs(client, e), await loadSettings(client))
  }

  /** Read-only check for the UI: why can / can't this enrolment be certified. */
  async function eligibility(actor: AuthContext, enrolmentId: string) {
    const e = await loadEnrolment(db, actor, enrolmentId)
    const [result, live] = await Promise.all([evaluate(db, e), db.query(`SELECT id FROM certificates WHERE enrolment_id = $1 AND status = 'issued'`, [e.id])])
    return { enrolmentId: e.id, batchCode: e.batchCode, programmeTitle: e.programmeTitle, traineeName: e.traineeName, alreadyIssued: live.rows.length > 0, ...result }
  }

  async function list(actor: AuthContext, f: CertificateFilter, sort: ParsedSort, page: PageParams) {
    const params: unknown[] = []
    const where = [visibility(actor, params)]
    if (f.institutionId) { const ids = scopeInstitutionIds(actor, f.institutionId); if (ids) { params.push(ids); where.push(`c.institution_id = ANY($${params.length}::uuid[])`) } }   // outside the caller's scope -> 404
    if (f.traineeId) { params.push(f.traineeId); where.push(`c.trainee_id = $${params.length}::uuid`) }
    if (f.enrolmentId) { params.push(f.enrolmentId); where.push(`c.enrolment_id = $${params.length}::uuid`) }
    if (f.programmeId) { params.push(f.programmeId); where.push(`c.programme_id = $${params.length}::uuid`) }
    if (f.status) { params.push(f.status); where.push(`c.status = $${params.length}`) }
    if (f.q) { params.push(likePattern(f.q)); where.push(`(c.certificate_no ILIKE $${params.length} OR c.holder_name ILIKE $${params.length} OR c.title ILIKE $${params.length})`) }
    return keysetList(db, { select: COLS, from: FROM, where, params, sort, idExpr: 'c.id', page, map: (r) => shapeCertificate(toRecord(r), actor.role) })
  }

  /** Record visible to the caller (shaped for their role) or 404. */
  async function getRecord(actor: AuthContext, id: string, client: Db | Tx = db): Promise<CertificateRecord> {
    const params: unknown[] = [id]
    const r = await client.query(`SELECT ${COLS} FROM ${FROM} WHERE c.id = $1 AND ${visibility(actor, params)}`, params)
    if (!r.rows[0]) throw AppError.notFound('Certificate')
    return toRecord(r.rows[0] as Row)
  }
  async function get(actor: AuthContext, id: string) { return shapeCertificate(await getRecord(actor, id), actor.role) }

  /**
   * Issue a certificate. Everything happens in one transaction: the enrolment row is locked (so two admins issuing at once
   * queue up and the second sees the first), eligibility is re-evaluated from live data, the certificate is inserted and the audit row written.
   * The partial unique index remains the last line of defence (409).
   */
  async function issue(actor: AuthContext, input: { enrolmentId: string }, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const e = await loadEnrolment(tx, actor, input.enrolmentId, true)
      const live = await tx.query(`SELECT id FROM certificates WHERE enrolment_id = $1 AND status = 'issued'`, [e.id])
      if (live.rows.length > 0) throw AppError.conflict('A live certificate already exists for this enrolment', { code: 'CERTIFICATE_EXISTS' })
      const settings = await loadSettings(tx)
      const result = evaluateEligibility(await loadInputs(tx, e), settings)
      if (!result.eligible) throw AppError.conflict('This enrolment is not eligible for a certificate', { code: 'NOT_ELIGIBLE', reasons: result.reasons })

      let row: Row | undefined
      for (let attempt = 0; attempt < 5 && !row; attempt++) {
        await tx.query('SAVEPOINT cert_insert')   // a unique violation aborts the transaction unless we roll back to here
        try {
          const r = await tx.query(
            `INSERT INTO certificates (certificate_no, verification_code, trainee_id, enrolment_id, programme_id, institution_id, title, holder_name, score, issued_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [generateCertificateNo(), generateVerificationCode(), e.traineeId, e.id, e.programmeId, e.institutionId, e.programmeTitle, e.traineeName, e.finalScore, actor.userId])
          row = r.rows[0] as Row
          await tx.query('RELEASE SAVEPOINT cert_insert')
        } catch (err) {
          const c = pgConstraint(err)
          if (c === CERT_ONE_LIVE_INDEX) throw AppError.conflict('A live certificate already exists for this enrolment', { code: 'CERTIFICATE_EXISTS' })
          if (c === CERT_UNIQUE_NO_CONSTRAINT || c === CERT_UNIQUE_CODE_CONSTRAINT) { await tx.query('ROLLBACK TO SAVEPOINT cert_insert'); continue }
          throw err
        }
      }
      if (!row) throw AppError.unavailable('Could not allocate a unique certificate number; please retry')

      const record = await getRecord(actor, row.id as string, tx)
      // The verification code is a credential-like value and is deliberately not written to the audit log.
      await writeAudit(tx, { ...auditBase(actor, info), action: 'certificate.issue', entityType: 'certificate', entityId: record.id, institutionId: e.institutionId,
        changes: { certificateNo: record.certificateNo, enrolmentId: e.id, traineeId: e.traineeId, programmeId: e.programmeId, attendancePercent: result.attendancePercent, assessments: result.assessments, thresholds: result.thresholds } })
      return shapeCertificate(record, actor.role)
    })
  }

  /**
   * Revoke with a mandatory reason. The row is locked so two concurrent revokes cannot both succeed; already-revoked is a 409.
   * The route permission (certificates:revoke) is super admin only, and institution scope is still asserted so a future role change stays safe.
   */
  async function revoke(actor: AuthContext, id: string, input: { reason: string }, info: ReqInfo) {
    return withTransaction(db, async (tx) => {
      const cur = (await tx.query(`SELECT id, status, institution_id, certificate_no FROM certificates WHERE id = $1 FOR UPDATE`, [id])).rows[0] as Row | undefined
      if (!cur) throw AppError.notFound('Certificate')
      assertInstitutionAccess(actor, cur.institution_id as string | null, 'Certificate')
      if (cur.status === 'revoked') throw AppError.conflict('This certificate is already revoked', { code: 'ALREADY_REVOKED' })
      await tx.query(`UPDATE certificates SET status = 'revoked', revoked_by = $2, revoked_at = now(), revocation_reason = $3 WHERE id = $1`, [id, actor.userId, input.reason])
      const record = await getRecord(actor, id, tx)
      await writeAudit(tx, { ...auditBase(actor, info), action: 'certificate.revoke', entityType: 'certificate', entityId: id, institutionId: (cur.institution_id as string | null) ?? null,
        changes: { certificateNo: cur.certificate_no, from: 'issued', to: 'revoked', reason: input.reason } })
      return shapeCertificate(record, actor.role)
    })
  }

  /** Public verification: unauthenticated, minimal fields. Anything that is not a valid, known code is the same generic 404. */
  async function verifyPublic(rawCode: string) {
    const code = normaliseVerificationCode(rawCode)
    if (!code) throw AppError.notFound('Certificate')
    const r = await db.query(`SELECT certificate_no, title, holder_name, status, issued_at FROM certificates WHERE verification_code = $1`, [code])
    const x = r.rows[0] as Row | undefined
    if (!x) throw AppError.notFound('Certificate')
    const { publicHolderName: mode } = await loadSettings()
    return toPublicVerification({ status: x.status as 'issued' | 'revoked', certificateNo: x.certificate_no as string, title: x.title as string,
      issuedAt: x.issued_at as Date, holderName: publicHolderName(x.holder_name as string, mode) })
  }

  /**
   * PDF of a certificate the caller may read (same scope as GET /certificates/:id, otherwise 404).
   * A revoked certificate is never rendered (409), so a revoked one cannot be passed around as valid.
   * Standard PDF fonts cannot draw Devanagari etc.; text they cannot encode is a clear 409, never wrong glyphs.
   */
  async function pdf(actor: AuthContext, id: string) {
    const c = await getRecord(actor, id)
    if (c.status === 'revoked') throw AppError.conflict('A revoked certificate cannot be downloaded', { code: 'CERTIFICATE_REVOKED' })
    const input = { certificateNo: c.certificateNo, holderName: c.holderName, programmeTitle: c.title, issuedOn: c.issuedAt.toISOString().slice(0, 10),
      verificationCode: c.verificationCode, verifyUrl: `${appBaseUrl}/verify/${c.verificationCode}` }
    if (!printedFields(input).every(isWinAnsiPrintable)) {
      throw AppError.conflict('This certificate contains characters (for example Devanagari) that the current PDF fonts cannot print', { code: 'UNSUPPORTED_CHARACTERS' })
    }
    return { filename: `${c.certificateNo}.pdf`, bytes: renderCertificatePdf(input, { now: c.issuedAt }) }
  }

  return { eligibility, list, get, getRecord, issue, revoke, verifyPublic, pdf }
}
export type CertificatesService = ReturnType<typeof createCertificatesService>
