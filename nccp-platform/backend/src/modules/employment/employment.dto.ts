import type { RoleCode } from '../../auth/permissions.js'

// ---------------------------------------------------------------- common
type Row = Record<string, unknown>

// ---------------------------------------------------------------- employer
export interface EmployerRecord {
  id: string; name: string; sector: string | null; location: string | null; website: string | null; about: string | null
  registrationNo: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null
  verificationStatus: string; rejectionReason: string | null; verifiedAt: Date | null
  createdAt: Date; updatedAt: Date; version: number
}

export function toEmployerRecord(r: Row): EmployerRecord {
  return {
    id: r.id as string, name: r.name as string, sector: (r.sector as string | null) ?? null, location: (r.location as string | null) ?? null,
    website: (r.website as string | null) ?? null, about: (r.about as string | null) ?? null, registrationNo: (r.registration_no as string | null) ?? null,
    contactName: (r.contact_name as string | null) ?? null, contactEmail: (r.contact_email as string | null) ?? null, contactPhone: (r.contact_phone as string | null) ?? null,
    verificationStatus: r.verification_status as string, rejectionReason: (r.rejection_reason as string | null) ?? null, verifiedAt: (r.verified_at as Date | null) ?? null,
    createdAt: r.created_at as Date, updatedAt: r.updated_at as Date, version: r.version as number,
  }
}

const ADMIN_ROLES: readonly RoleCode[] = ['super_admin', 'institution_admin']

export function shapeEmployer(e: EmployerRecord, role: RoleCode) {
  const admin = ADMIN_ROLES.includes(role)
  return {
    id: e.id, name: e.name, sector: e.sector, location: e.location, website: e.website, about: e.about,
    registrationNo: admin || role === 'employer' ? e.registrationNo : null,
    contactName: admin || role === 'employer' ? e.contactName : null,
    contactEmail: admin || role === 'employer' ? e.contactEmail : null,
    contactPhone: admin || role === 'employer' ? e.contactPhone : null,
    verificationStatus: e.verificationStatus, rejectionReason: admin ? e.rejectionReason : null,
    verifiedAt: e.verifiedAt, createdAt: e.createdAt, updatedAt: e.updatedAt, version: e.version,
  }
}

// ---------------------------------------------------------------- job
export interface JobRecord {
  id: string; employerId: string; title: string; employmentType: string; openings: number; location: string | null
  workMode: string | null; experience: string | null; salaryText: string | null; salaryMin: number | null; salaryMax: number | null
  description: string | null; requiredSkills: string | null; preferredSkills: string | null; qualification: string | null; benefits: string | null
  deadline: string | null; status: string; publishedAt: Date | null; closedAt: Date | null
  createdAt: Date; updatedAt: Date; version: number
}

export function toJobRecord(r: Row): JobRecord {
  return {
    id: r.id as string, employerId: r.employer_id as string, title: r.title as string, employmentType: r.employment_type as string,
    openings: r.openings as number, location: (r.location as string | null) ?? null, workMode: (r.work_mode as string | null) ?? null,
    experience: (r.experience as string | null) ?? null, salaryText: (r.salary_text as string | null) ?? null,
    salaryMin: (r.salary_min as number | null) ?? null, salaryMax: (r.salary_max as number | null) ?? null,
    description: (r.description as string | null) ?? null, requiredSkills: (r.required_skills as string | null) ?? null,
    preferredSkills: (r.preferred_skills as string | null) ?? null, qualification: (r.qualification as string | null) ?? null,
    benefits: (r.benefits as string | null) ?? null, deadline: (r.deadline as string | null) ?? null,
    status: r.status as string, publishedAt: (r.published_at as Date | null) ?? null, closedAt: (r.closed_at as Date | null) ?? null,
    createdAt: r.created_at as Date, updatedAt: r.updated_at as Date, version: r.version as number,
  }
}

/** Trainees see the public fields; employers and admins see everything. */
export function shapeJob(j: JobRecord, role: RoleCode) {
  return {
    id: j.id, employerId: j.employerId, title: j.title, employmentType: j.employmentType, openings: j.openings,
    location: j.location, workMode: j.workMode, experience: j.experience,
    salaryText: j.salaryText, salaryMin: j.salaryMin, salaryMax: j.salaryMax,
    description: j.description, requiredSkills: j.requiredSkills, preferredSkills: j.preferredSkills,
    qualification: j.qualification, benefits: j.benefits, deadline: j.deadline,
    status: j.status, publishedAt: j.publishedAt, closedAt: j.closedAt,
    createdAt: j.createdAt, updatedAt: j.updatedAt, version: j.version,
  }
}

// ---------------------------------------------------------------- application
export interface ApplicationRecord {
  id: string; jobId: string; traineeId: string; status: string; matchScore: number | null
  coverNote: string | null; employerNotes: string | null; appliedAt: Date; updatedAt: Date; version: number
}

export function toApplicationRecord(r: Row): ApplicationRecord {
  return {
    id: r.id as string, jobId: r.job_id as string, traineeId: r.trainee_id as string, status: r.status as string,
    matchScore: (r.match_score as number | null) ?? null, coverNote: (r.cover_note as string | null) ?? null,
    employerNotes: (r.employer_notes as string | null) ?? null, appliedAt: r.applied_at as Date,
    updatedAt: r.updated_at as Date, version: r.version as number,
  }
}

/** Trainees do not see employer notes; employer notes are visible only to employer and admin roles. */
export function shapeApplication(a: ApplicationRecord, role: RoleCode) {
  return {
    id: a.id, jobId: a.jobId, traineeId: a.traineeId, status: a.status,
    matchScore: a.matchScore, coverNote: a.coverNote,
    employerNotes: role === 'employer' || ADMIN_ROLES.includes(role) ? a.employerNotes : null,
    appliedAt: a.appliedAt, updatedAt: a.updatedAt, version: a.version,
  }
}

// ---------------------------------------------------------------- interview
export interface InterviewRecord {
  id: string; applicationId: string; scheduledAt: Date; mode: string; locationOrLink: string | null
  notes: string | null; status: string; outcomeNotes: string | null
  createdAt: Date; updatedAt: Date; version: number
}

export function toInterviewRecord(r: Row): InterviewRecord {
  return {
    id: r.id as string, applicationId: r.application_id as string, scheduledAt: r.scheduled_at as Date,
    mode: r.mode as string, locationOrLink: (r.location_or_link as string | null) ?? null,
    notes: (r.notes as string | null) ?? null, status: r.status as string, outcomeNotes: (r.outcome_notes as string | null) ?? null,
    createdAt: r.created_at as Date, updatedAt: r.updated_at as Date, version: r.version as number,
  }
}

export function shapeInterview(i: InterviewRecord, role: RoleCode) {
  return {
    id: i.id, applicationId: i.applicationId, scheduledAt: i.scheduledAt, mode: i.mode, locationOrLink: i.locationOrLink,
    notes: role === 'employer' || ADMIN_ROLES.includes(role) ? i.notes : null,
    status: i.status,
    outcomeNotes: role === 'employer' || ADMIN_ROLES.includes(role) ? i.outcomeNotes : null,
    createdAt: i.createdAt, updatedAt: i.updatedAt, version: i.version,
  }
}

// ---------------------------------------------------------------- placement
export interface PlacementRecord {
  id: string; applicationId: string; employerId: string; traineeId: string; jobId: string
  joiningDate: string | null; salaryOffered: number | null; status: string
  createdAt: Date; updatedAt: Date; version: number
}

export function toPlacementRecord(r: Row): PlacementRecord {
  return {
    id: r.id as string, applicationId: r.application_id as string, employerId: r.employer_id as string,
    traineeId: r.trainee_id as string, jobId: r.job_id as string,
    joiningDate: (r.joining_date as string | null) ?? null, salaryOffered: (r.salary_offered as number | null) ?? null,
    status: r.status as string, createdAt: r.created_at as Date, updatedAt: r.updated_at as Date, version: r.version as number,
  }
}

export function shapePlacement(p: PlacementRecord, role: RoleCode) {
  return {
    id: p.id, applicationId: p.applicationId, employerId: p.employerId, traineeId: p.traineeId, jobId: p.jobId,
    joiningDate: p.joiningDate, salaryOffered: role === 'trainee' ? null : p.salaryOffered,
    status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt, version: p.version,
  }
}

// ---------------------------------------------------------------- status history
export interface StatusHistoryEntry { id: number; fromStatus: string | null; toStatus: string; changedBy: string | null; note: string | null; changedAt: Date }
export function toStatusHistoryEntry(r: Row): StatusHistoryEntry {
  return { id: r.id as number, fromStatus: (r.from_status as string | null) ?? null, toStatus: r.to_status as string, changedBy: (r.changed_by as string | null) ?? null, note: (r.note as string | null) ?? null, changedAt: r.changed_at as Date }
}
