import { AppError } from '../../lib/errors.js'
import { isIsoDate } from '../../lib/list-query.js'

export type BatchStatus = 'planned' | 'ongoing' | 'completed' | 'cancelled'
const ALLOWED: Record<BatchStatus, readonly BatchStatus[]> = { planned: ['ongoing', 'cancelled'], ongoing: ['completed', 'cancelled'], completed: [], cancelled: [] }
export const isBatchClosed = (s: BatchStatus): boolean => s === 'completed' || s === 'cancelled'

/** planned->ongoing (needs a trainer), planned->cancelled, ongoing->completed, ongoing->cancelled. Everything else is a 409. */
export function planBatchTransition(current: BatchStatus, target: BatchStatus, opts: { hasTrainer: boolean }): BatchStatus {
  if (!ALLOWED[current]?.includes(target)) throw AppError.conflict(`A ${current} batch cannot become ${target}`)
  if (target === 'ongoing' && !opts.hasTrainer) throw AppError.conflict('Assign a trainer before starting the batch')
  return target
}

/** Both dates must be real calendar dates and the end may not precede the start. Throws 422 with field paths. */
export function validateBatchDates(startDate: string, endDate: string): void {
  const issues: Array<{ path: string; message: string }> = []
  if (!isIsoDate(startDate)) issues.push({ path: 'startDate', message: 'Use a valid date (YYYY-MM-DD)' })
  if (!isIsoDate(endDate)) issues.push({ path: 'endDate', message: 'Use a valid date (YYYY-MM-DD)' })
  if (issues.length === 0 && endDate < startDate) issues.push({ path: 'endDate', message: 'End date cannot be before the start date' })
  if (issues.length) throw AppError.validation(issues)
}

/** Capacity may not drop below the seats already taken (statuses in CAPACITY_STATUSES). */
export function validateCapacity(capacity: number, occupied: number): void {
  if (!Number.isInteger(capacity) || capacity < 1) throw AppError.validation([{ path: 'capacity', message: 'Capacity must be a positive whole number' }])
  if (capacity < occupied) throw AppError.validation([{ path: 'capacity', message: `Capacity cannot be lower than the ${occupied} trainees already enrolled` }])
}
