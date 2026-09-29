/**
 * NCCP Platform — Typed API client layer
 *
 * Every function maps 1-to-1 to a backend route (see backend/src/modules/learning/routes.ts
 * and other route files). All calls go through the central `apiRequest` helper which
 * handles JWT refresh, request-id injection and standardised error payloads.
 *
 * PostgreSQL persistence is provided entirely by the backend services — the frontend
 * never touches the database directly.
 */

import { apiRequest } from './api-client'

// ---------------------------------------------------------------------------
// Shared pagination shape
// ---------------------------------------------------------------------------
export interface Page<T> {
  data: T[]
  total: number
  limit: number
  hasMore: boolean
  nextCursor?: string
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface LoginPayload { email: string; password: string; mfaCode?: string }
export interface AuthUser { id: string; email: string; fullName: string; role: string }
export interface LoginResponse { accessToken: string; user: AuthUser }

export const authApi = {
  login: (body: LoginPayload) =>
    apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  refresh: () =>
    apiRequest<{ accessToken: string }>('/auth/refresh', { method: 'POST' }),
  logout: () =>
    apiRequest('/auth/logout', { method: 'POST' }),
  me: () =>
    apiRequest<AuthUser>('/auth/me'),
}

// ---------------------------------------------------------------------------
// Enrolments  ->  batch_enrolments rows in PostgreSQL
// ---------------------------------------------------------------------------
export interface Enrolment {
  id: string; batchId: string; batchCode: string; traineeId: string; traineeName: string
  status: 'applied' | 'enrolled' | 'in_progress' | 'completed' | 'dropped' | 'rejected'
  enrolledAt: string; createdAt: string; version: number
}
export const enrolmentsApi = {
  list: (params?: Record<string, string>) =>
    apiRequest<Page<Enrolment>>('/enrolments?' + new URLSearchParams(params).toString()),
  get: (id: string) => apiRequest<Enrolment>(`/enrolments/${id}`),
  /** Trainee self-applies for a batch — inserts an 'applied' row in the batch_enrolments table */
  apply: (batchId: string) =>
    apiRequest<Enrolment>('/enrolments/apply', { method: 'POST', body: JSON.stringify({ batchId }) }),
  /** Admin / trainer transitions status — UPDATE on the batch_enrolments row */
  transition: (id: string, action: string, reason?: string, finalScore?: number) =>
    apiRequest<Enrolment>(`/enrolments/${id}/status`, {
      method: 'POST', body: JSON.stringify({ action, reason, finalScore }),
    }),
}

// ---------------------------------------------------------------------------
// Courses / Modules / Lessons  ->  lms_* tables in PostgreSQL
// ---------------------------------------------------------------------------
export interface Course {
  id: string; programmeId: string; title: string; description: string | null
  position: number; status: 'draft' | 'published' | 'archived'; version: number; createdAt: string
}
export interface Lesson {
  id: string; moduleId: string; title: string; lessonType: string
  content: string | null; durationMin: number | null; position: number; version: number; createdAt: string
}
export interface LessonProgress { lessonId: string; status: 'in_progress' | 'completed' }

export const coursesApi = {
  list: (params?: Record<string, string>) =>
    apiRequest<Page<Course>>('/courses?' + new URLSearchParams(params).toString()),
  get: (id: string) => apiRequest<Course>(`/courses/${id}`),
  outline: (id: string) => apiRequest(`/courses/${id}/outline`),
  create: (body: { programmeId: string; title: string } & Partial<Course>) =>
    apiRequest<Course>('/courses', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, patch: Partial<Course>, etag?: string) =>
    apiRequest<Course>(`/courses/${id}`, {
      method: 'PATCH', headers: etag ? { 'If-Match': etag } : {}, body: JSON.stringify(patch),
    }),
  remove: (id: string) => apiRequest(`/courses/${id}`, { method: 'DELETE' }),
  /** Updates the lesson_progress row for the authenticated trainee in PostgreSQL */
  setLessonProgress: (lessonId: string, status: 'in_progress' | 'completed') =>
    apiRequest<LessonProgress>(`/lessons/${lessonId}/progress`, {
      method: 'PUT', body: JSON.stringify({ status }),
    }),
}

// ---------------------------------------------------------------------------
// Sessions (timetable)  ->  class_sessions rows in PostgreSQL
// ---------------------------------------------------------------------------
export interface ClassSession {
  id: string; batchId: string; batchCode: string; title: string
  startsAt: string; endsAt: string; mode: 'offline' | 'online'
  status: 'scheduled' | 'live' | 'completed' | 'cancelled'
  joinUrl: string | null; location: string | null; version: number; createdAt: string
}
export const sessionsApi = {
  list: (params?: Record<string, string>) =>
    apiRequest<Page<ClassSession>>('/sessions?' + new URLSearchParams(params).toString()),
  timetable: (params: { from: string; to: string; batchId?: string }) =>
    apiRequest<ClassSession[]>('/timetable?' + new URLSearchParams(params as Record<string, string>).toString()),
  create: (body: { batchId: string; title: string; startsAt: string; endsAt: string; mode?: string; joinUrl?: string; location?: string }) =>
    apiRequest<ClassSession>('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, patch: Partial<ClassSession>, etag?: string) =>
    apiRequest<ClassSession>(`/sessions/${id}`, {
      method: 'PATCH', headers: etag ? { 'If-Match': etag } : {}, body: JSON.stringify(patch),
    }),
  transition: (id: string, status: 'live' | 'completed' | 'cancelled') =>
    apiRequest<ClassSession>(`/sessions/${id}/status`, {
      method: 'POST', body: JSON.stringify({ status }),
    }),
  remove: (id: string) => apiRequest(`/sessions/${id}`, { method: 'DELETE' }),
}

// ---------------------------------------------------------------------------
// Attendance  ->  attendance rows in PostgreSQL
// ---------------------------------------------------------------------------
export interface AttendanceRecord {
  id: string; sessionId: string; sessionTitle: string; startsAt: string
  batchId: string; batchCode: string; traineeId: string; traineeName: string
  status: string; method: string; verification: string | null
  checkedInAt: string | null; notes: string | null; version: number; createdAt: string
}
export interface AttendanceMethods {
  manual: { available: boolean }
  online: { available: boolean }
  qr: { available: boolean; ttlSeconds: number }
  fingerprint: { available: boolean; simulated: boolean }
  /**
   * face.available === true when the camera-capture provider is active in the backend.
   *
   * FACE RECOGNITION PIPELINE (implemented — no external ML or cloud AI required yet):
   *   Client  : Camera opens via getUserMedia() -> frame captured to canvas -> toDataURL('image/jpeg')
   *             -> base-64 string sent as `proof` to POST /attendance/sessions/:id/verify/face
   *   Backend : standardFaceCaptureProvider (biometric.ts) validates proof length (>=20 chars)
   *             -> attendance row written with method='face', verification='face_provider'
   *
   * TO UPGRADE TO REAL ML:
   *   Replace standardFaceCaptureProvider with a real FaceProvider implementation that calls
   *   face-api.js (client-side descriptor matching) OR a cloud Vision/Rekognition/Azure Face
   *   API endpoint. The FaceProvider interface in biometric.ts is the plug-in contract —
   *   no other file needs to change.
   */
  face: { available: boolean }
}
export interface AttendanceState {
  sessionId: string; open: boolean; openedAt: string | null; openedBy: string | null; closedAt: string | null
}
export interface QrToken { token: string; expiresAt: string }

export const attendanceApi = {
  /** Returns what verification methods are currently enabled per the backend feature flags */
  methods: () => apiRequest<AttendanceMethods>('/attendance/methods'),

  list: (params?: Record<string, string>) =>
    apiRequest<Page<AttendanceRecord>>('/attendance?' + new URLSearchParams(params).toString()),

  summary: (batchId: string, traineeId?: string) =>
    apiRequest<{ batchId: string; batchCode: string; data: Array<{ traineeId: string; traineeName: string; sessionsCounted: number; present: number; late: number; excused: number; absent: number; attendancePercent: number }> }>(
      `/attendance/summary?batchId=${batchId}${traineeId ? `&traineeId=${traineeId}` : ''}`
    ),

  state: (sessionId: string) =>
    apiRequest<AttendanceState>(`/attendance/sessions/${sessionId}/state`),

  /** Trainer opens attendance — sets attendance_opened_at and rotates QR secret in PostgreSQL */
  open: (sessionId: string) =>
    apiRequest<AttendanceState>(`/attendance/sessions/${sessionId}/open`, { method: 'POST' }),

  close: (sessionId: string) =>
    apiRequest<AttendanceState>(`/attendance/sessions/${sessionId}/close`, { method: 'POST' }),

  /** Returns a rotating QR token (valid 30 s) — the secret lives in class_sessions.qr_secret */
  currentQr: (sessionId: string) =>
    apiRequest<QrToken & { sessionId: string }>(`/attendance/sessions/${sessionId}/qr`),

  /** Trainee submits a QR token — HMAC-verified against the rotating secret in PostgreSQL */
  verifyQr: (sessionId: string, token: string) =>
    apiRequest<AttendanceRecord>(`/attendance/sessions/${sessionId}/verify/qr`, {
      method: 'POST', body: JSON.stringify({ token }),
    }),

  /** Trainee submits fingerprint proof — routes through the FingerprintProvider abstraction */
  verifyFingerprint: (sessionId: string, opts: { simulatedKey?: string; deviceProof?: string }) =>
    apiRequest<AttendanceRecord>(`/attendance/sessions/${sessionId}/verify/fingerprint`, {
      method: 'POST', body: JSON.stringify(opts),
    }),

  /**
   * Face recognition attendance check-in.
   *
   * `proof` is a base-64-encoded JPEG frame from the device camera.
   * The backend standardFaceCaptureProvider validates the payload and writes the attendance row.
   * Swap the provider in biometric.ts to add real ML without changing this call signature.
   */
  verifyFace: (sessionId: string, proof: string) =>
    apiRequest<AttendanceRecord>(`/attendance/sessions/${sessionId}/verify/face`, {
      method: 'POST', body: JSON.stringify({ proof }),
    }),

  /** Trainer bulk-mark — upserts multiple attendance rows in one transaction */
  markBulk: (sessionId: string, records: Array<{ traineeId: string; status: string; method?: string; notes?: string | null }>) =>
    apiRequest<{ data: AttendanceRecord[] }>(`/attendance/sessions/${sessionId}`, {
      method: 'PUT', body: JSON.stringify({ records }),
    }),

  /** Plain self-check-in (no token) — INSERT into the attendance table */
  selfCheckIn: (sessionId: string, method?: 'manual' | 'online') =>
    apiRequest<AttendanceRecord>(`/attendance/sessions/${sessionId}/check-in`, {
      method: 'POST', body: JSON.stringify(method ? { method } : {}),
    }),
}

// ---------------------------------------------------------------------------
// Assessments  ->  assessments + assessment_results tables in PostgreSQL
// ---------------------------------------------------------------------------
export interface Assessment {
  id: string; batchId: string; title: string; assessmentType: string
  totalMarks: number; passMarks: number; maxAttempts: number
  status: 'draft' | 'published' | 'closed'; opensAt: string | null; dueAt: string | null
  version: number; createdAt: string
}
export interface AssessmentResult {
  id: string; assessmentId: string; traineeId: string; traineeName: string
  status: 'in_progress' | 'submitted' | 'graded'; score: number | null
  percentage: number | null; passed: boolean | null; feedback: string | null
  version: number; createdAt: string
}
export const assessmentsApi = {
  list: (params?: Record<string, string>) =>
    apiRequest<Page<Assessment>>('/assessments?' + new URLSearchParams(params).toString()),
  get: (id: string) => apiRequest<Assessment>(`/assessments/${id}`),
  /** Trainee submits answers — auto-grades MCQ, writes result row in PostgreSQL */
  submitAttempt: (id: string, answers: Record<string, string>) =>
    apiRequest<AssessmentResult>(`/assessments/${id}/attempts`, {
      method: 'POST', body: JSON.stringify({ answers }),
    }),
  results: (id: string, params?: Record<string, string>) =>
    apiRequest<Page<AssessmentResult>>(`/assessments/${id}/results?` + new URLSearchParams(params).toString()),
  grade: (id: string, resultId: string, score: number, feedback?: string, etag?: string) =>
    apiRequest<AssessmentResult>(`/assessments/${id}/results/${resultId}/grade`, {
      method: 'POST',
      headers: etag ? { 'If-Match': etag } : {},
      body: JSON.stringify({ score, feedback }),
    }),
  create: (body: { batchId: string; title: string; totalMarks: number; passMarks: number }) =>
    apiRequest<Assessment>('/assessments', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, patch: Partial<Assessment>, etag?: string) =>
    apiRequest<Assessment>(`/assessments/${id}`, {
      method: 'PATCH', headers: etag ? { 'If-Match': etag } : {}, body: JSON.stringify(patch),
    }),
  transition: (id: string, status: 'published' | 'closed') =>
    apiRequest<Assessment>(`/assessments/${id}/status`, {
      method: 'POST', body: JSON.stringify({ status }),
    }),
  summary: (batchId: string, traineeId?: string) =>
    apiRequest(`/assessments/summary?batchId=${batchId}${traineeId ? `&traineeId=${traineeId}` : ''}`),
}

// ---------------------------------------------------------------------------
// Certificates  ->  certificates table in PostgreSQL
// ---------------------------------------------------------------------------
export interface Certificate {
  id: string; traineeId: string; traineeName: string; batchId: string; batchCode: string
  title: string; grade: string | null; certificateNumber: string
  issuedAt: string | null; status: 'pending' | 'issued' | 'revoked'; version: number; createdAt: string
}
export const certificatesApi = {
  list: (params?: Record<string, string>) =>
    apiRequest<Page<Certificate>>('/certificates?' + new URLSearchParams(params).toString()),
  get: (id: string) => apiRequest<Certificate>(`/certificates/${id}`),
  verify: (certificateNumber: string) =>
    apiRequest<Certificate>(`/certificates/verify?number=${encodeURIComponent(certificateNumber)}`),
  /** Writes/updates the certificates row and stamps issuedAt in PostgreSQL */
  issue: (id: string, etag?: string) =>
    apiRequest<Certificate>(`/certificates/${id}/issue`, {
      method: 'POST', headers: etag ? { 'If-Match': etag } : {},
    }),
}

// ---------------------------------------------------------------------------
// Employment / Job board  ->  job_postings + job_applications tables in PostgreSQL
// ---------------------------------------------------------------------------
export interface JobPosting {
  id: string; employerId: string; employerName: string; title: string
  location: string | null; salaryRange: string | null; description: string | null
  requiredSkills: string[]; status: 'draft' | 'open' | 'closed'; createdAt: string
}
export interface JobApplication {
  id: string; jobPostingId: string; jobTitle: string; traineeId: string; traineeName: string
  status: 'applied' | 'under_review' | 'shortlisted' | 'interview' | 'offer' | 'joined' | 'rejected'
  appliedAt: string; updatedAt: string
}
export const employmentApi = {
  listJobs: (params?: Record<string, string>) =>
    apiRequest<Page<JobPosting>>('/jobs?' + new URLSearchParams(params).toString()),
  getJob: (id: string) => apiRequest<JobPosting>(`/jobs/${id}`),
  /** Trainee applies — INSERT into job_applications */
  apply: (jobId: string) =>
    apiRequest<JobApplication>(`/jobs/${jobId}/apply`, { method: 'POST' }),
  myApplications: (params?: Record<string, string>) =>
    apiRequest<Page<JobApplication>>('/jobs/applications/mine?' + new URLSearchParams(params).toString()),
  /** Employer/admin transitions status — UPDATE on the job_applications row */
  updateApplicationStatus: (applicationId: string, status: string) =>
    apiRequest<JobApplication>(`/jobs/applications/${applicationId}/status`, {
      method: 'POST', body: JSON.stringify({ status }),
    }),
  createJob: (body: { title: string } & Partial<JobPosting>) =>
    apiRequest<JobPosting>('/jobs', { method: 'POST', body: JSON.stringify(body) }),
  updateJob: (id: string, patch: Partial<JobPosting>) =>
    apiRequest<JobPosting>(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
}

// ---------------------------------------------------------------------------
// Notifications  ->  notifications table in PostgreSQL
// ---------------------------------------------------------------------------
export interface PlatformNotification {
  id: string; title: string; body: string; category: string; read: boolean; createdAt: string
}
export const notificationsApi = {
  list: (params?: Record<string, string>) =>
    apiRequest<Page<PlatformNotification>>('/notifications?' + new URLSearchParams(params).toString()),
  markRead: (id: string) =>
    apiRequest<PlatformNotification>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => apiRequest('/notifications/read-all', { method: 'POST' }),
}

// ---------------------------------------------------------------------------
// User profile  ->  users table in PostgreSQL
// ---------------------------------------------------------------------------
export interface UserProfile {
  id: string; email: string; fullName: string; phone: string | null
  district: string | null; educationLevel: string | null; careerGoal: string | null
  preferredLanguage: string | null; role: string; createdAt: string
}
export const profileApi = {
  get: () => apiRequest<UserProfile>('/profile'),
  update: (patch: Partial<Omit<UserProfile, 'id' | 'email' | 'role' | 'createdAt'>>) =>
    apiRequest<UserProfile>('/profile', { method: 'PATCH', body: JSON.stringify(patch) }),
}

// ---------------------------------------------------------------------------
// Skill Wallet  ->  trainee_skills table in PostgreSQL
// ---------------------------------------------------------------------------
export interface Skill {
  id: string; traineeId: string; skillName: string; proficiencyPct: number
  evidence: string | null; verifiedBy: string | null; status: 'in_progress' | 'verified'; createdAt: string
}
export const skillsApi = {
  list: (params?: Record<string, string>) =>
    apiRequest<Page<Skill>>('/skills?' + new URLSearchParams(params).toString()),
  create: (body: { skillName: string; proficiencyPct: number; evidence?: string }) =>
    apiRequest<Skill>('/skills', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, patch: Partial<Skill>) =>
    apiRequest<Skill>(`/skills/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string) => apiRequest(`/skills/${id}`, { method: 'DELETE' }),
}

// ---------------------------------------------------------------------------
// Hostel  ->  hostel_requests table in PostgreSQL
// ---------------------------------------------------------------------------
export interface HostelRequest {
  id: string; traineeId: string; type: string; details: string
  status: 'open' | 'in_progress' | 'resolved'; createdAt: string
}
export const hostelApi = {
  list: (params?: Record<string, string>) =>
    apiRequest<Page<HostelRequest>>('/hostel?' + new URLSearchParams(params).toString()),
  create: (body: { type: string; details: string }) =>
    apiRequest<HostelRequest>('/hostel', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, patch: Partial<HostelRequest>) =>
    apiRequest<HostelRequest>(`/hostel/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
}

// ---------------------------------------------------------------------------
// Help & Support  ->  support_tickets table in PostgreSQL
// ---------------------------------------------------------------------------
export interface SupportTicket {
  id: string; subject: string; category: string; details: string
  status: 'open' | 'in_progress' | 'resolved'; createdAt: string
}
export const supportApi = {
  list: (params?: Record<string, string>) =>
    apiRequest<Page<SupportTicket>>('/support?' + new URLSearchParams(params).toString()),
  create: (body: { subject: string; category: string; details: string }) =>
    apiRequest<SupportTicket>('/support', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, patch: { status: string }) =>
    apiRequest<SupportTicket>(`/support/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
}

// ---------------------------------------------------------------------------
// Workspace Persistence  ->  workspace_records in PostgreSQL
// ---------------------------------------------------------------------------
export interface WorkspaceRecordDto<T = Record<string, unknown>> {
  id: string
  workspace: string
  module: string
  data: T
  status: string
  version: number
  createdAt: string
  updatedAt: string
}

export const workspaceApi = {
  list: <T = Record<string, unknown>>(workspace: string, module?: string) =>
    apiRequest<{ data: Array<WorkspaceRecordDto<T>> }>(
      `/workspace/${workspace}/records${module ? `?module=${encodeURIComponent(module)}` : ''}`
    ),
  save: <T = Record<string, unknown>>(workspace: string, module: string, item: { id: string; data: T; status?: string }) =>
    apiRequest<{ data: WorkspaceRecordDto<T> }>(`/workspace/${workspace}/records`, {
      method: 'POST',
      body: JSON.stringify({ id: item.id, module, data: item.data, status: item.status }),
    }),
  delete: (workspace: string, id: string, module?: string) =>
    apiRequest<{ success: boolean }>(
      `/workspace/${workspace}/records/${id}${module ? `?module=${encodeURIComponent(module)}` : ''}`,
      { method: 'DELETE' }
    ),
  batchSync: (workspace: string, items: Array<{ id: string; module: string; data: Record<string, unknown>; status?: string }>) =>
    apiRequest<{ count: number }>(`/workspace/${workspace}/sync`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
}

