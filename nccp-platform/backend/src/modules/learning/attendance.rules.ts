import { AppError } from '../../lib/errors.js'

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]
export const ATTENDANCE_METHODS = ['manual', 'qr', 'fingerprint', 'face', 'online'] as const
export type AttendanceMethod = (typeof ATTENDANCE_METHODS)[number]
/**
 * Methods a trainee may claim through the plain check-in endpoint. qr / fingerprint / face are PROOF methods: they can only be
 * recorded by their verify endpoints (signed QR token, fingerprint provider, face provider), never by an unverified claim.
 */
export const SELF_CHECKIN_METHODS: readonly AttendanceMethod[] = ['manual', 'online']
/** Methods staff may write in a bulk mark. Verified methods are never written by hand so per-method analytics stay honest. */
export const STAFF_MARK_METHODS: readonly AttendanceMethod[] = ['manual', 'online']

export const CHECKIN_OPENS_BEFORE_MIN = 15
export const LATE_AFTER_MIN = 15

/**
 * Self check-in window and result. Opens 15 minutes before the session starts and closes when it ends; checking in more
 * than 15 minutes after the start counts as 'late'. Times are epoch milliseconds.
 */
export function planSelfCheckIn(startsAtMs: number, endsAtMs: number, nowMs: number): AttendanceStatus {
  if (nowMs < startsAtMs - CHECKIN_OPENS_BEFORE_MIN * 60_000) throw AppError.conflict('Check-in has not opened yet')
  if (nowMs >= endsAtMs) throw AppError.conflict('This session has ended; ask your trainer to mark attendance')
  return nowMs > startsAtMs + LATE_AFTER_MIN * 60_000 ? 'late' : 'present'
}

export interface AttendanceCounts { present: number; late: number; absent: number; excused: number; counted: number }
/**
 * Attendance percentage used for certificate eligibility (Part 5).
 * counted = finished, non-cancelled sessions in the batch; excused sessions leave the denominator;
 * late counts as attended; a finished session with no record counts as absent.
 * Returns null when nothing is countable yet.
 */
export function attendancePercent(c: AttendanceCounts): number | null {
  const denominator = c.counted - c.excused
  if (denominator <= 0) return null
  return Math.round(((c.present + c.late) / denominator) * 10_000) / 100
}
