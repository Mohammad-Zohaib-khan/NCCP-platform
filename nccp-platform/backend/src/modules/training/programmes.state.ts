import { AppError } from '../../lib/errors.js'

export type ProgrammeStatus = 'draft' | 'pending_approval' | 'active' | 'archived' | 'rejected'
export type ProgrammeAction = 'submit' | 'approve' | 'reject' | 'archive'
export const PROGRAMME_ACTIONS: readonly ProgrammeAction[] = ['submit', 'approve', 'reject', 'archive']
/** A programme can be edited only while it is a draft or was rejected. */
export const EDITABLE_PROGRAMME_STATUSES: readonly ProgrammeStatus[] = ['draft', 'rejected']
export const isProgrammeEditable = (s: ProgrammeStatus): boolean => EDITABLE_PROGRAMME_STATUSES.includes(s)
export const MIN_REASON_LENGTH = 3

export interface ProgrammeTransitionContext { national: boolean; isSuperAdmin: boolean; reason?: string | null }

/**
 * draft|rejected -> pending_approval (submit); pending_approval -> active (approve, super admin) or rejected (reject, super admin,
 * reason required); active -> archived. A super admin may approve a national programme straight from draft.
 * 409 for a transition the current status does not allow; 403 when a non-super-admin tries to approve/reject; 422 for a missing reason.
 */
export function planProgrammeTransition(current: ProgrammeStatus, action: ProgrammeAction, ctx: ProgrammeTransitionContext): { to: ProgrammeStatus; reason: string | null } {
  const reason = ctx.reason?.trim() || null
  switch (action) {
    case 'submit':
      if (current !== 'draft' && current !== 'rejected') throw AppError.conflict(`Cannot submit a programme that is ${current}`)
      return { to: 'pending_approval', reason: null }
    case 'approve':
      if (!ctx.isSuperAdmin) throw AppError.forbidden('Only NCCP administrators can approve programmes')
      if (current === 'pending_approval' || (current === 'draft' && ctx.national)) return { to: 'active', reason: null }
      throw AppError.conflict(`Cannot approve a programme that is ${current}`)
    case 'reject':
      if (!ctx.isSuperAdmin) throw AppError.forbidden('Only NCCP administrators can reject programmes')
      if (current !== 'pending_approval') throw AppError.conflict(`Cannot reject a programme that is ${current}`)
      if (!reason || reason.length < MIN_REASON_LENGTH) throw AppError.validation([{ path: 'reason', message: `A reason of at least ${MIN_REASON_LENGTH} characters is required to reject` }])
      return { to: 'rejected', reason }
    case 'archive':
      if (current !== 'active') throw AppError.conflict(`Cannot archive a programme that is ${current}`)
      return { to: 'archived', reason: null }
    default:
      throw AppError.badRequest(`Unknown action '${String(action)}'`)
  }
}
