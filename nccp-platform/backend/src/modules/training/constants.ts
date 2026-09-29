/**
 * Enrolment statuses that occupy a seat in a batch. Batch capacity checks (Part 3) and enrolment (Part 4) must both use
 * this list so seat counting can never disagree.
 */
export const CAPACITY_STATUSES = ['enrolled', 'in_progress', 'completed'] as const
export type CapacityStatus = (typeof CAPACITY_STATUSES)[number]
/** SQL literal list of CAPACITY_STATUSES. Built only from the constant above (never from request input). */
export const capacityStatusesSql = (): string => CAPACITY_STATUSES.map((s) => `'${s}'`).join(', ')
