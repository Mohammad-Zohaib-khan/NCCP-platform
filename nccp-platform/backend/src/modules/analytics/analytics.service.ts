import type { Db } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import { isSuperAdmin, type AuthContext } from '../../auth/context.js'

type Row = Record<string, unknown>

export interface AttendanceBreakdown {
  total: number
  manual: number
  qr: number
  fingerprint: number
  face: number
}

export interface NationalDashboard {
  scope: 'national'
  institutions: { total: number; active: number; pending: number }
  training: { programmes: number; batches: number; activeBatches: number; trainees: number; trainers: number; enrolments: number }
  certificates: { issued: number; revoked: number }
  employment: { employers: number; verifiedEmployers: number; activeJobs: number; applications: number; placements: number }
  attendance: { totalMarked: number; attendanceRatePercent: number; breakdown: AttendanceBreakdown }
}

export interface InstitutionDashboard {
  scope: 'institution'
  trainers: number
  trainees: number
  programmes: number
  batches: { total: number; active: number }
  enrolments: { total: number; active: number; completed: number }
  certificates: { issued: number }
  placements: number
  attendance: { totalMarked: number; attendanceRatePercent: number; breakdown: AttendanceBreakdown }
}

export interface TrainerDashboard {
  scope: 'trainer'
  assignedBatches: number
  activeBatches: number
  totalTrainees: number
  sessionsHeld: number
  attendance: { totalMarked: number; attendanceRatePercent: number; breakdown: AttendanceBreakdown }
}

export interface TraineeDashboard {
  scope: 'trainee'
  enrolments: { total: number; active: number; completed: number }
  attendanceRatePercent: number
  certificatesCount: number
  applications: { total: number; active: number; placed: number }
}

export interface EmployerDashboard {
  scope: 'employer'
  jobs: { total: number; active: number }
  applications: { total: number; review: number; shortlisted: number; interview: number; offer: number; placed: number }
  placements: number
  averageMatchScore: number | null
}

export function createAnalyticsService(db: Db) {

  async function getNationalDashboard(): Promise<NationalDashboard> {
    const instRes = await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status = 'pending')::int AS pending
         FROM institutions WHERE deleted_at IS NULL`,
    )
    const inst = instRes.rows[0] as Row

    const trRes = await db.query(
      `SELECT (SELECT count(*)::int FROM programmes WHERE deleted_at IS NULL) AS programmes,
              (SELECT count(*)::int FROM batches WHERE deleted_at IS NULL) AS batches,
              (SELECT count(*)::int FROM batches WHERE status = 'in_progress' AND deleted_at IS NULL) AS active_batches,
              (SELECT count(*)::int FROM trainees WHERE deleted_at IS NULL) AS trainees,
              (SELECT count(*)::int FROM trainers WHERE deleted_at IS NULL) AS trainers,
              (SELECT count(*)::int FROM batch_enrolments) AS enrolments`,
    )
    const tr = trRes.rows[0] as Row

    const certRes = await db.query(
      `SELECT count(*) FILTER (WHERE status = 'issued')::int AS issued,
              count(*) FILTER (WHERE status = 'revoked')::int AS revoked
         FROM certificates`,
    )
    const cert = certRes.rows[0] as Row

    const empRes = await db.query(
      `SELECT (SELECT count(*)::int FROM employers WHERE deleted_at IS NULL) AS employers,
              (SELECT count(*)::int FROM employers WHERE verification_status = 'verified' AND deleted_at IS NULL) AS verified_employers,
              (SELECT count(*)::int FROM jobs WHERE status = 'active' AND deleted_at IS NULL) AS active_jobs,
              (SELECT count(*)::int FROM applications) AS applications,
              (SELECT count(*)::int FROM placements) AS placements`,
    )
    const emp = empRes.rows[0] as Row

    const attRes = await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status IN ('present', 'late'))::int AS attended,
              count(*) FILTER (WHERE method = 'manual')::int AS manual,
              count(*) FILTER (WHERE method = 'qr')::int AS qr,
              count(*) FILTER (WHERE method = 'fingerprint')::int AS fingerprint,
              count(*) FILTER (WHERE method = 'face')::int AS face
         FROM attendance_records`,
    )
    const att = attRes.rows[0] as Row
    const totalAtt = (att.total as number) || 0
    const attended = (att.attended as number) || 0
    const attRate = totalAtt > 0 ? Math.round((attended / totalAtt) * 1000) / 10 : 0

    return {
      scope: 'national',
      institutions: { total: inst.total as number, active: inst.active as number, pending: inst.pending as number },
      training: {
        programmes: tr.programmes as number,
        batches: tr.batches as number,
        activeBatches: tr.active_batches as number,
        trainees: tr.trainees as number,
        trainers: tr.trainers as number,
        enrolments: tr.enrolments as number,
      },
      certificates: { issued: cert.issued as number, revoked: cert.revoked as number },
      employment: {
        employers: emp.employers as number,
        verifiedEmployers: emp.verified_employers as number,
        activeJobs: emp.active_jobs as number,
        applications: emp.applications as number,
        placements: emp.placements as number,
      },
      attendance: {
        totalMarked: totalAtt,
        attendanceRatePercent: attRate,
        breakdown: {
          total: totalAtt,
          manual: att.manual as number,
          qr: att.qr as number,
          fingerprint: att.fingerprint as number,
          face: att.face as number,
        },
      },
    }
  }

  async function getInstitutionDashboard(institutionIds: string[]): Promise<InstitutionDashboard> {
    const res = await db.query(
      `SELECT (SELECT count(*)::int FROM trainers WHERE institution_id = ANY($1::uuid[]) AND deleted_at IS NULL) AS trainers,
              (SELECT count(*)::int FROM trainees WHERE institution_id = ANY($1::uuid[]) AND deleted_at IS NULL) AS trainees,
              (SELECT count(*)::int FROM programmes WHERE institution_id = ANY($1::uuid[]) AND deleted_at IS NULL) AS programmes,
              (SELECT count(*)::int FROM batches WHERE institution_id = ANY($1::uuid[]) AND deleted_at IS NULL) AS batches_total,
              (SELECT count(*)::int FROM batches WHERE institution_id = ANY($1::uuid[]) AND status = 'in_progress' AND deleted_at IS NULL) AS batches_active,
              (SELECT count(*)::int FROM batch_enrolments be JOIN batches b ON b.id = be.batch_id WHERE b.institution_id = ANY($1::uuid[])) AS enrolments_total,
              (SELECT count(*)::int FROM batch_enrolments be JOIN batches b ON b.id = be.batch_id WHERE b.institution_id = ANY($1::uuid[]) AND be.status = 'active') AS enrolments_active,
              (SELECT count(*)::int FROM batch_enrolments be JOIN batches b ON b.id = be.batch_id WHERE b.institution_id = ANY($1::uuid[]) AND be.status = 'completed') AS enrolments_completed,
              (SELECT count(*)::int FROM certificates WHERE institution_id = ANY($1::uuid[]) AND status = 'issued') AS certificates_issued,
              (SELECT count(*)::int FROM placements p JOIN trainees t ON t.id = p.trainee_id WHERE t.institution_id = ANY($1::uuid[])) AS placements,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id WHERE b.institution_id = ANY($1::uuid[])) AS att_total,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id WHERE b.institution_id = ANY($1::uuid[]) AND a.status IN ('present','late')) AS att_attended,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id WHERE b.institution_id = ANY($1::uuid[]) AND a.method = 'manual') AS att_manual,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id WHERE b.institution_id = ANY($1::uuid[]) AND a.method = 'qr') AS att_qr,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id WHERE b.institution_id = ANY($1::uuid[]) AND a.method = 'fingerprint') AS att_fingerprint,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id WHERE b.institution_id = ANY($1::uuid[]) AND a.method = 'face') AS att_face`,
      [institutionIds],
    )
    const r = res.rows[0] as Row
    const totalAtt = (r.att_total as number) || 0
    const attended = (r.att_attended as number) || 0
    const attRate = totalAtt > 0 ? Math.round((attended / totalAtt) * 1000) / 10 : 0

    return {
      scope: 'institution',
      trainers: r.trainers as number,
      trainees: r.trainees as number,
      programmes: r.programmes as number,
      batches: { total: r.batches_total as number, active: r.batches_active as number },
      enrolments: { total: r.enrolments_total as number, active: r.enrolments_active as number, completed: r.enrolments_completed as number },
      certificates: { issued: r.certificates_issued as number },
      placements: r.placements as number,
      attendance: {
        totalMarked: totalAtt,
        attendanceRatePercent: attRate,
        breakdown: {
          total: totalAtt,
          manual: r.att_manual as number,
          qr: r.att_qr as number,
          fingerprint: r.att_fingerprint as number,
          face: r.att_face as number,
        },
      },
    }
  }

  async function getTrainerDashboard(trainerUserId: string): Promise<TrainerDashboard> {
    const res = await db.query(
      `SELECT (SELECT count(*)::int FROM batches b JOIN trainers t ON t.id = b.trainer_id WHERE t.user_id = $1 AND b.deleted_at IS NULL) AS batches_total,
              (SELECT count(*)::int FROM batches b JOIN trainers t ON t.id = b.trainer_id WHERE t.user_id = $1 AND b.status = 'in_progress' AND b.deleted_at IS NULL) AS batches_active,
              (SELECT count(*)::int FROM batch_enrolments be JOIN batches b ON b.id = be.batch_id JOIN trainers t ON t.id = b.trainer_id WHERE t.user_id = $1) AS trainees_total,
              (SELECT count(*)::int FROM batch_sessions bs JOIN batches b ON b.id = bs.batch_id JOIN trainers t ON t.id = b.trainer_id WHERE t.user_id = $1 AND bs.status = 'completed') AS sessions_held,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id JOIN trainers t ON t.id = b.trainer_id WHERE t.user_id = $1) AS att_total,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id JOIN trainers t ON t.id = b.trainer_id WHERE t.user_id = $1 AND a.status IN ('present','late')) AS att_attended,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id JOIN trainers t ON t.id = b.trainer_id WHERE t.user_id = $1 AND a.method = 'manual') AS att_manual,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id JOIN trainers t ON t.id = b.trainer_id WHERE t.user_id = $1 AND a.method = 'qr') AS att_qr,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id JOIN trainers t ON t.id = b.trainer_id WHERE t.user_id = $1 AND a.method = 'fingerprint') AS att_fingerprint,
              (SELECT count(*)::int FROM attendance_records a JOIN batch_sessions bs ON bs.id = a.session_id JOIN batches b ON b.id = bs.batch_id JOIN trainers t ON t.id = b.trainer_id WHERE t.user_id = $1 AND a.method = 'face') AS att_face`,
      [trainerUserId],
    )
    const r = res.rows[0] as Row
    const totalAtt = (r.att_total as number) || 0
    const attended = (r.att_attended as number) || 0
    const attRate = totalAtt > 0 ? Math.round((attended / totalAtt) * 1000) / 10 : 0

    return {
      scope: 'trainer',
      assignedBatches: r.batches_total as number,
      activeBatches: r.batches_active as number,
      totalTrainees: r.trainees_total as number,
      sessionsHeld: r.sessions_held as number,
      attendance: {
        totalMarked: totalAtt,
        attendanceRatePercent: attRate,
        breakdown: {
          total: totalAtt,
          manual: r.att_manual as number,
          qr: r.att_qr as number,
          fingerprint: r.att_fingerprint as number,
          face: r.att_face as number,
        },
      },
    }
  }

  async function getTraineeDashboard(traineeUserId: string): Promise<TraineeDashboard> {
    const res = await db.query(
      `SELECT (SELECT count(*)::int FROM batch_enrolments be JOIN trainees t ON t.id = be.trainee_id WHERE t.user_id = $1) AS enrolments_total,
              (SELECT count(*)::int FROM batch_enrolments be JOIN trainees t ON t.id = be.trainee_id WHERE t.user_id = $1 AND be.status = 'active') AS enrolments_active,
              (SELECT count(*)::int FROM batch_enrolments be JOIN trainees t ON t.id = be.trainee_id WHERE t.user_id = $1 AND be.status = 'completed') AS enrolments_completed,
              (SELECT count(*)::int FROM certificates c JOIN trainees t ON t.id = c.trainee_id WHERE t.user_id = $1 AND c.status = 'issued') AS cert_count,
              (SELECT count(*)::int FROM applications a JOIN trainees t ON t.id = a.trainee_id WHERE t.user_id = $1) AS apps_total,
              (SELECT count(*)::int FROM applications a JOIN trainees t ON t.id = a.trainee_id WHERE t.user_id = $1 AND a.status IN ('review','shortlisted','interview','offer')) AS apps_active,
              (SELECT count(*)::int FROM applications a JOIN trainees t ON t.id = a.trainee_id WHERE t.user_id = $1 AND a.status = 'placed') AS apps_placed,
              (SELECT count(*)::int FROM attendance_records ar JOIN trainees t ON t.id = ar.trainee_id WHERE t.user_id = $1) AS att_total,
              (SELECT count(*)::int FROM attendance_records ar JOIN trainees t ON t.id = ar.trainee_id WHERE t.user_id = $1 AND ar.status IN ('present','late')) AS att_attended`,
      [traineeUserId],
    )
    const r = res.rows[0] as Row
    const totalAtt = (r.att_total as number) || 0
    const attended = (r.att_attended as number) || 0
    const attRate = totalAtt > 0 ? Math.round((attended / totalAtt) * 1000) / 10 : 0

    return {
      scope: 'trainee',
      enrolments: {
        total: r.enrolments_total as number,
        active: r.enrolments_active as number,
        completed: r.enrolments_completed as number,
      },
      attendanceRatePercent: attRate,
      certificatesCount: r.cert_count as number,
      applications: {
        total: r.apps_total as number,
        active: r.apps_active as number,
        placed: r.apps_placed as number,
      },
    }
  }

  async function getEmployerDashboard(employerIds: string[]): Promise<EmployerDashboard> {
    const res = await db.query(
      `SELECT (SELECT count(*)::int FROM jobs WHERE employer_id = ANY($1::uuid[]) AND deleted_at IS NULL) AS jobs_total,
              (SELECT count(*)::int FROM jobs WHERE employer_id = ANY($1::uuid[]) AND status = 'active' AND deleted_at IS NULL) AS jobs_active,
              (SELECT count(*)::int FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.employer_id = ANY($1::uuid[])) AS apps_total,
              (SELECT count(*)::int FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.employer_id = ANY($1::uuid[]) AND a.status = 'review') AS apps_review,
              (SELECT count(*)::int FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.employer_id = ANY($1::uuid[]) AND a.status = 'shortlisted') AS apps_shortlisted,
              (SELECT count(*)::int FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.employer_id = ANY($1::uuid[]) AND a.status = 'interview') AS apps_interview,
              (SELECT count(*)::int FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.employer_id = ANY($1::uuid[]) AND a.status = 'offer') AS apps_offer,
              (SELECT count(*)::int FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.employer_id = ANY($1::uuid[]) AND a.status = 'placed') AS apps_placed,
              (SELECT count(*)::int FROM placements WHERE employer_id = ANY($1::uuid[])) AS placements,
              (SELECT avg(match_score)::float8 FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.employer_id = ANY($1::uuid[]) AND a.match_score IS NOT NULL) AS avg_match`,
      [employerIds],
    )
    const r = res.rows[0] as Row

    return {
      scope: 'employer',
      jobs: { total: r.jobs_total as number, active: r.jobs_active as number },
      applications: {
        total: r.apps_total as number,
        review: r.apps_review as number,
        shortlisted: r.apps_shortlisted as number,
        interview: r.apps_interview as number,
        offer: r.apps_offer as number,
        placed: r.apps_placed as number,
      },
      placements: r.placements as number,
      averageMatchScore: r.avg_match ? Math.round((r.avg_match as number) * 100) / 100 : null,
    }
  }

  async function getDashboard(actor: AuthContext) {
    if (actor.role === 'super_admin') return getNationalDashboard()
    if (actor.role === 'institution_admin') return getInstitutionDashboard(actor.institutionIds)
    if (actor.role === 'trainer') return getTrainerDashboard(actor.userId)
    if (actor.role === 'trainee') return getTraineeDashboard(actor.userId)
    if (actor.role === 'employer') return getEmployerDashboard(actor.employerIds)
    throw AppError.forbidden()
  }

  return { getDashboard, getNationalDashboard, getInstitutionDashboard, getTrainerDashboard, getTraineeDashboard, getEmployerDashboard }
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>
