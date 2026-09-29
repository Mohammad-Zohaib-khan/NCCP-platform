import { AppError } from '../../lib/errors.js'

export type EnrolmentStatus = 'applied' | 'enrolled' | 'in_progress' | 'completed' | 'dropped' | 'rejected'
export type EnrolmentAction = 'approve' | 'reject' | 'start' | 'complete' | 'drop' | 'withdraw'

/** action -> from-status -> resulting status. Anything not listed is a 409. */
const TRANSITIONS: Record<EnrolmentAction, Partial<Record<EnrolmentStatus, EnrolmentStatus>>> = {
  approve:  { applied: 'enrolled' },
  reject:   { applied: 'rejected' },
  start:    { enrolled: 'in_progress' },
  complete: { enrolled: 'completed', in_progress: 'completed' },
  drop:     { applied: 'dropped', enrolled: 'dropped', in_progress: 'dropped' },
  withdraw: { applied: 'dropped', enrolled: 'dropped' },
}
/** Actions only staff may take; 'withdraw' is the trainee's own action. */
export const STAFF_ACTIONS: readonly EnrolmentAction[] = ['approve', 'reject', 'start', 'complete', 'drop']

export function planEnrolmentTransition(from: EnrolmentStatus, action: EnrolmentAction, opts: { reason?: string } = {}): EnrolmentStatus {
  const to = TRANSITIONS[action]?.[from]
  if (!to) throw AppError.conflict(`Cannot ${action} an enrolment that is ${from}`)
  if (action === 'reject' && !opts.reason?.trim()) throw AppError.validation([{ path: 'reason', message: 'A reason is required to reject an application' }])
  return to
}
/** Statuses from which a trainee may be enrolled again (the row is reused because of UNIQUE(batch_id, trainee_id)). */
export const REENROLLABLE: readonly EnrolmentStatus[] = ['dropped', 'rejected']
/** Batch statuses that accept new enrolments. */
export const ENROLLABLE_BATCH_STATUSES: readonly string[] = ['planned', 'ongoing']
