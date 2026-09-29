import { AppError } from '../../lib/errors.js'

export type InstitutionStatus = 'pending' | 'active' | 'suspended' | 'rejected'
export type InstitutionAction = 'approve' | 'reject' | 'suspend' | 'reactivate' | 'reopen'
export const INSTITUTION_ACTIONS: readonly InstitutionAction[] = ['approve', 'reject', 'suspend', 'reactivate', 'reopen']

interface Rule { from: InstitutionStatus; to: InstitutionStatus; reasonRequired: boolean }
const RULES: Record<InstitutionAction, Rule> = {
  approve:    { from: 'pending',   to: 'active',    reasonRequired: false },
  reject:     { from: 'pending',   to: 'rejected',  reasonRequired: true },
  suspend:    { from: 'active',    to: 'suspended', reasonRequired: true },
  reactivate: { from: 'suspended', to: 'active',    reasonRequired: false },
  reopen:     { from: 'rejected',  to: 'pending',   reasonRequired: false },
}
export const MIN_REASON_LENGTH = 3

/** Validate a transition and return the target status. 409 when not allowed from the current state, 422 when a reason is missing. */
export function planInstitutionTransition(current: InstitutionStatus, action: InstitutionAction, reason?: string | null): { to: InstitutionStatus; reason: string | null } {
  const rule = RULES[action]
  if (!rule) throw AppError.badRequest(`Unknown action '${String(action)}'`)
  if (current !== rule.from) throw AppError.conflict(`Cannot ${action} an institution that is ${current}`)
  const trimmed = reason?.trim() ?? ''
  if (rule.reasonRequired && trimmed.length < MIN_REASON_LENGTH) throw AppError.validation([{ path: 'reason', message: `A reason of at least ${MIN_REASON_LENGTH} characters is required to ${action}` }])
  return { to: rule.to, reason: trimmed || null }
}
