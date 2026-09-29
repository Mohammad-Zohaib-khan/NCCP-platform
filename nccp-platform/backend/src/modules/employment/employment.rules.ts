import { AppError } from '../../lib/errors.js'
import { isIsoDate } from '../../lib/list-query.js'

/**
 * Pure employment rules (no database, no framework): employer verification, job lifecycle, application stages,
 * interviews, placements and the documented match-score formula. Services load the facts; every decision lives here.
 */
export const MIN_REASON_LENGTH = 3
const reason = (raw: string | null | undefined, required: boolean, what: string): string | null => {
  const t = raw?.trim() ?? ''
  if (required && t.length < MIN_REASON_LENGTH) throw AppError.validation([{ path: 'reason', message: `A reason of at least ${MIN_REASON_LENGTH} characters is required to ${what}` }])
  return t || null
}

// ---------------------------------------------------------------- employer verification
export type EmployerStatus = 'unverified' | 'pending' | 'verified' | 'rejected' | 'suspended'
export type EmployerAction = 'verify' | 'reject' | 'suspend' | 'reinstate' | 'reopen'
export const EMPLOYER_ACTIONS: readonly EmployerAction[] = ['verify', 'reject', 'suspend', 'reinstate', 'reopen']
const EMPLOYER_RULES: Record<EmployerAction, { from: readonly EmployerStatus[]; to: EmployerStatus; reasonRequired: boolean }> = {
  verify:    { from: ['unverified', 'pending'], to: 'verified',  reasonRequired: false },
  reject:    { from: ['unverified', 'pending'], to: 'rejected',  reasonRequired: true },
  suspend:   { from: ['verified'],              to: 'suspended', reasonRequired: true },
  reinstate: { from: ['suspended'],             to: 'verified',  reasonRequired: false },
  reopen:    { from: ['rejected'],              to: 'pending',   reasonRequired: false },
}
/** 409 when the action is not allowed from the current status, 422 when a required reason is missing. */
export function planEmployerTransition(current: EmployerStatus, action: EmployerAction, why?: string | null): { to: EmployerStatus; reason: string | null } {
  const rule = EMPLOYER_RULES[action]
  if (!rule) throw AppError.badRequest(`Unknown action '${String(action)}'`)
  if (!rule.from.includes(current)) throw AppError.conflict(`Cannot ${action} an employer that is ${current}`)
  return { to: rule.to, reason: reason(why, rule.reasonRequired, action) }
}
export const isEmployerVerified = (s: string): boolean => s === 'verified'

// ---------------------------------------------------------------- jobs
export type JobStatus = 'draft' | 'active' | 'paused' | 'closed'
export type JobAction = 'publish' | 'pause' | 'resume' | 'close'
export const JOB_ACTIONS: readonly JobAction[] = ['publish', 'pause', 'resume', 'close']
const JOB_RULES: Record<JobAction, { from: readonly JobStatus[]; to: JobStatus; needsVerifiedEmployer: boolean }> = {
  publish: { from: ['draft'],                   to: 'active', needsVerifiedEmployer: true },
  pause:   { from: ['active'],                  to: 'paused', needsVerifiedEmployer: false },
  resume:  { from: ['paused'],                  to: 'active', needsVerifiedEmployer: true },
  close:   { from: ['draft', 'active', 'paused'], to: 'closed', needsVerifiedEmployer: false },
}
/** Only a verified employer can make a job visible (publish or resume). Closed is final: create a new job instead. */
export function planJobTransition(current: JobStatus, action: JobAction, employerStatus: string): JobStatus {
  const rule = JOB_RULES[action]
  if (!rule) throw AppError.badRequest(`Unknown action '${String(action)}'`)
  if (!rule.from.includes(current)) throw AppError.conflict(`Cannot ${action} a job that is ${current}`)
  if (rule.needsVerifiedEmployer && !isEmployerVerified(employerStatus)) throw AppError.conflict('Only a verified employer can publish jobs', { code: 'EMPLOYER_NOT_VERIFIED' })
  return rule.to
}
/** Closed jobs are read-only; draft, active and paused jobs can be edited. */
export const isJobEditable = (s: JobStatus): boolean => s !== 'closed'
/** Trainees can discover and apply to a job only when it is active, not deleted, and its employer is verified (checked in SQL and again here). */
export const isJobOpenForApplications = (j: { status: string; deadline: string | null; employerStatus: string }, today: string): boolean =>
  j.status === 'active' && isEmployerVerified(j.employerStatus) && (j.deadline === null || j.deadline >= today)

export interface JobPublishInput { title: string; description?: string | null; openings: number; location?: string | null; workMode?: string | null; deadline?: string | null }
/** Everything a job needs before it goes live. All problems are reported together (422). */
export function validateJobForPublish(j: JobPublishInput, today: string): void {
  const issues: Array<{ path: string; message: string }> = []
  if ((j.title?.trim().length ?? 0) < 3) issues.push({ path: 'title', message: 'A job title of at least 3 characters is required' })
  if ((j.description?.trim().length ?? 0) < 20) issues.push({ path: 'description', message: 'Describe the role (at least 20 characters) before publishing' })
  if (!Number.isInteger(j.openings) || j.openings < 1) issues.push({ path: 'openings', message: 'Openings must be a positive whole number' })
  if (!j.location?.trim() && !/remote/i.test(j.workMode ?? '')) issues.push({ path: 'location', message: 'Give a location, or set the work mode to Remote' })
  if (j.deadline) {
    if (!isIsoDate(j.deadline)) issues.push({ path: 'deadline', message: 'Use a valid date (YYYY-MM-DD)' })
    else if (j.deadline < today) issues.push({ path: 'deadline', message: 'The deadline is in the past' })
  }
  if (issues.length) throw AppError.validation(issues)
}
export function validateSalary(min?: number | null, max?: number | null): void {
  const issues: Array<{ path: string; message: string }> = []
  for (const [path, v] of [['salaryMin', min], ['salaryMax', max]] as const) if (v != null && (!Number.isFinite(v) || v < 0 || v > 1e10)) issues.push({ path, message: 'Enter a sensible non-negative amount' })
  if (issues.length === 0 && min != null && max != null && max < min) issues.push({ path: 'salaryMax', message: 'Maximum salary cannot be below the minimum' })
  if (issues.length) throw AppError.validation(issues)
}

// ---------------------------------------------------------------- applications
export type ApplicationStatus = 'review' | 'shortlisted' | 'interview' | 'offer' | 'placed' | 'rejected' | 'withdrawn'
export type ApplicationAction = 'shortlist' | 'interview' | 'offer' | 'place' | 'reject' | 'withdraw'
export const APPLICATION_ACTIONS: readonly ApplicationAction[] = ['shortlist', 'interview', 'offer', 'place', 'reject', 'withdraw']
const OPEN: readonly ApplicationStatus[] = ['review', 'shortlisted', 'interview', 'offer']
export const isApplicationOpen = (s: string): boolean => (OPEN as readonly string[]).includes(s)
const APPLICATION_RULES: Record<ApplicationAction, { from: readonly ApplicationStatus[]; to: ApplicationStatus; by: 'employer' | 'trainee'; reasonRequired: boolean }> = {
  shortlist: { from: ['review'],      to: 'shortlisted', by: 'employer', reasonRequired: false },
  interview: { from: ['shortlisted'], to: 'interview',   by: 'employer', reasonRequired: false },
  offer:     { from: ['interview'],   to: 'offer',       by: 'employer', reasonRequired: false },
  place:     { from: ['offer'],       to: 'placed',      by: 'employer', reasonRequired: false },
  reject:    { from: OPEN,            to: 'rejected',    by: 'employer', reasonRequired: true },
  withdraw:  { from: OPEN,            to: 'withdrawn',   by: 'trainee',  reasonRequired: false },
}
/** Stages move one step at a time; reject and withdraw are possible from any open stage; placed, rejected and withdrawn are final. */
export function planApplicationTransition(current: ApplicationStatus, action: ApplicationAction, side: 'employer' | 'trainee', why?: string | null): { to: ApplicationStatus; note: string | null } {
  const rule = APPLICATION_RULES[action]
  if (!rule) throw AppError.badRequest(`Unknown action '${String(action)}'`)
  if (rule.by !== side) throw AppError.forbidden(rule.by === 'trainee' ? 'Only the applicant can withdraw an application' : 'Only the employer can do this')
  if (!rule.from.includes(current)) throw AppError.conflict(`Cannot ${action} an application that is ${current}`)
  return { to: rule.to, note: reason(why, rule.reasonRequired, action) }
}

// ---------------------------------------------------------------- interviews
export type InterviewStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
export type InterviewMode = 'video' | 'phone' | 'in_person'
const INTERVIEW_NEXT: Record<InterviewStatus, readonly InterviewStatus[]> = {
  scheduled: ['confirmed', 'completed', 'cancelled', 'no_show'], confirmed: ['completed', 'cancelled', 'no_show'], completed: [], cancelled: [], no_show: [],
}
export function planInterviewTransition(current: InterviewStatus, target: InterviewStatus): InterviewStatus {
  if (!INTERVIEW_NEXT[current]?.includes(target)) throw AppError.conflict(`A ${current} interview cannot become ${target}`)
  return target
}
export const isInterviewLive = (s: string): boolean => s === 'scheduled' || s === 'confirmed'
/** Scheduling: in the future (and within a year), and a video or in-person interview needs somewhere to go. A video link must be http(s). */
export function validateInterview(i: { scheduledAt: Date; mode: InterviewMode; locationOrLink?: string | null }, now: Date): void {
  const issues: Array<{ path: string; message: string }> = []
  const t = i.scheduledAt.getTime()
  if (Number.isNaN(t)) issues.push({ path: 'scheduledAt', message: 'Use a valid date and time' })
  else if (t <= now.getTime()) issues.push({ path: 'scheduledAt', message: 'The interview must be in the future' })
  else if (t > now.getTime() + 366 * 86_400_000) issues.push({ path: 'scheduledAt', message: 'The interview cannot be more than a year ahead' })
  const where = i.locationOrLink?.trim() ?? ''
  if ((i.mode === 'video' || i.mode === 'in_person') && !where) issues.push({ path: 'locationOrLink', message: i.mode === 'video' ? 'Give the meeting link' : 'Give the address' })
  if (i.mode === 'video' && where && !/^https?:\/\/\S+$/i.test(where)) issues.push({ path: 'locationOrLink', message: 'The meeting link must start with http:// or https://' })
  if (issues.length) throw AppError.validation(issues)
}

// ---------------------------------------------------------------- placements
export type PlacementStatus = 'confirmed' | 'joined' | 'not_joined' | 'left'
/** confirmed -> joined | not_joined; joined -> left. not_joined and left are final. */
const PLACEMENT_NEXT: Record<PlacementStatus, readonly PlacementStatus[]> = { confirmed: ['joined', 'not_joined'], joined: ['left'], not_joined: [], left: [] }
export function planPlacementTransition(current: PlacementStatus, target: PlacementStatus): PlacementStatus {
  if (!PLACEMENT_NEXT[current]?.includes(target)) throw AppError.conflict(`A ${current} placement cannot become ${target}`)
  return target
}
/** Placements that still occupy an opening. */
export const PLACEMENT_OCCUPIES_OPENING: readonly PlacementStatus[] = ['confirmed', 'joined']
export function validatePlacement(p: { joiningDate?: string | null; salaryOffered?: number | null }): void {
  const issues: Array<{ path: string; message: string }> = []
  if (p.joiningDate != null && !isIsoDate(p.joiningDate)) issues.push({ path: 'joiningDate', message: 'Use a valid date (YYYY-MM-DD)' })
  if (p.salaryOffered != null && (!Number.isFinite(p.salaryOffered) || p.salaryOffered < 0 || p.salaryOffered > 1e10)) issues.push({ path: 'salaryOffered', message: 'Enter a sensible non-negative amount' })
  if (issues.length) throw AppError.validation(issues)
}
/** A job cannot place more people than it has openings. */
export function assertOpeningAvailable(openings: number, occupied: number): void {
  if (occupied >= openings) throw AppError.conflict(`All ${openings} opening${openings === 1 ? '' : 's'} for this job are already filled`, { code: 'OPENINGS_FILLED' })
}

// ---------------------------------------------------------------- match score
/**
 * Match score, 0-100, stored on the application when the trainee applies. Formula (documented, no AI, no fuzzy matching):
 *   skills        60 points  required-skill overlap 45 + preferred-skill overlap 15 (if only one list exists it takes all 60;
 *                            if the job lists no skills at all the component is neutral: 30)
 *   location      20 points  remote work mode = 20; the trainee's location, district or state appears in the job location (or the
 *                            reverse) = 20; the job gives no location = 10 (neutral); otherwise 0
 *   certification 20 points  the trainee holds a live (issued, not revoked) NCCP certificate
 * Skills compare as trimmed, lower-cased, whitespace-collapsed whole entries. It is an ordering aid for employers, not a decision.
 */
export const MATCH_WEIGHTS = { requiredSkills: 45, preferredSkills: 15, skillsOnly: 60, skillsNeutral: 30, location: 20, locationNeutral: 10, certification: 20 } as const

const norm = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
/** "Solar wiring, PV design; Safety\nfirst" -> ['solar wiring','pv design','safety','first']. Caps: 50 entries of 60 characters. */
export function parseSkillList(raw: string | readonly string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? [...raw] : typeof raw === 'string' ? raw.split(/[,;\n|]/) : []
  const out: string[] = []
  for (const p of parts) { const n = norm(String(p)); if (n && n.length <= 60 && !out.includes(n)) out.push(n); if (out.length >= 50) break }
  return out
}
export interface MatchInput {
  requiredSkills?: string | null; preferredSkills?: string | null; jobLocation?: string | null; workMode?: string | null
  trainee: { skills: readonly string[]; location?: string | null; district?: string | null; state?: string | null }
  hasLiveCertificate: boolean
}
export interface MatchResult { score: number; breakdown: { skills: number; location: number; certification: number; matchedRequired: string[]; missingRequired: string[]; matchedPreferred: string[] } }
export function computeMatchScore(m: MatchInput): MatchResult {
  const W = MATCH_WEIGHTS
  const have = new Set(parseSkillList(m.trainee.skills))
  const req = parseSkillList(m.requiredSkills), pref = parseSkillList(m.preferredSkills)
  const matchedRequired = req.filter((s) => have.has(s)), matchedPreferred = pref.filter((s) => have.has(s))
  const missingRequired = req.filter((s) => !have.has(s))
  let skills: number
  if (req.length === 0 && pref.length === 0) skills = W.skillsNeutral
  else if (req.length && pref.length) skills = W.requiredSkills * (matchedRequired.length / req.length) + W.preferredSkills * (matchedPreferred.length / pref.length)
  else if (req.length) skills = W.skillsOnly * (matchedRequired.length / req.length)
  else skills = W.skillsOnly * (matchedPreferred.length / pref.length)

  let location = 0
  const job = norm(m.jobLocation ?? '')
  if (/remote/i.test(m.workMode ?? '')) location = W.location
  else if (!job) location = W.locationNeutral
  else {
    const places = [m.trainee.location, m.trainee.district, m.trainee.state].map((p) => norm(p ?? '')).filter((p) => p.length >= 3)
    if (places.some((p) => job.includes(p) || p.includes(job))) location = W.location
  }
  const certification = m.hasLiveCertificate ? W.certification : 0
  const round = (n: number) => Math.round(n * 100) / 100
  const score = Math.min(100, Math.max(0, round(skills + location + certification)))
  return { score, breakdown: { skills: round(skills), location, certification, matchedRequired, missingRequired, matchedPreferred } }
}
