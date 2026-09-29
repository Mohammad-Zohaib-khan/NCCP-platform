import { AppError } from '../../lib/errors.js'

export type SessionStatus = 'scheduled' | 'live' | 'completed' | 'cancelled'
const NEXT: Record<SessionStatus, readonly SessionStatus[]> = {
  scheduled: ['live', 'completed', 'cancelled'],
  live: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}
export const isSessionClosed = (s: SessionStatus): boolean => s === 'completed' || s === 'cancelled'
export function planSessionTransition(from: SessionStatus, to: SessionStatus): SessionStatus {
  if (!NEXT[from].includes(to)) throw AppError.conflict(`A ${from} session cannot become ${to}`)
  return to
}

const MAX_SESSION_HOURS = 12
export function validateSessionTimes(startsAt: string, endsAt: string): void {
  const s = Date.parse(startsAt); const e = Date.parse(endsAt)
  if (Number.isNaN(s)) throw AppError.validation([{ path: 'startsAt', message: 'startsAt is not a valid date-time' }])
  if (Number.isNaN(e)) throw AppError.validation([{ path: 'endsAt', message: 'endsAt is not a valid date-time' }])
  if (e <= s) throw AppError.validation([{ path: 'endsAt', message: 'endsAt must be after startsAt' }])
  if (e - s > MAX_SESSION_HOURS * 3_600_000) throw AppError.validation([{ path: 'endsAt', message: `A session cannot be longer than ${MAX_SESSION_HOURS} hours` }])
}
/** An online session needs a join link; an offline one may carry a location instead. */
export function validateSessionMode(mode: 'online' | 'offline', joinUrl: string | null | undefined): void {
  if (mode === 'online' && !joinUrl) throw AppError.validation([{ path: 'joinUrl', message: 'An online session needs a joinUrl' }])
}
