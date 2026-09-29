import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AppError } from '../src/lib/errors.js'
import { planInstitutionTransition, type InstitutionAction, type InstitutionStatus } from '../src/modules/institutions/state.js'
import { planProgrammeTransition, isProgrammeEditable, type ProgrammeAction, type ProgrammeStatus } from '../src/modules/training/programmes.state.js'
import { planBatchTransition, validateBatchDates, validateCapacity, isBatchClosed, type BatchStatus } from '../src/modules/training/batches.state.js'
import { CAPACITY_STATUSES, capacityStatusesSql } from '../src/modules/training/constants.js'
import { readFileSync } from 'node:fs'
import { scopeInstitutionIds, resolveInstitutionId, type AuthContext } from '../src/auth/context.js'

const status = (code: number) => (e: unknown) => e instanceof AppError && e.statusCode === code
const ctx = (over: Partial<AuthContext>): AuthContext => ({ userId: 'u1', role: 'institution_admin', sessionId: 's', fullName: 'A', email: 'a@b.c', institutionIds: ['i1', 'i2'], employerIds: [], mfaEnabled: false, mfaSetupRequired: false, ...over })

// ---------- institutions ----------
test('institution transitions: every allowed path', () => {
  assert.equal(planInstitutionTransition('pending', 'approve').to, 'active')
  assert.equal(planInstitutionTransition('pending', 'reject', 'incomplete documents').to, 'rejected')
  assert.equal(planInstitutionTransition('active', 'suspend', 'audit finding').to, 'suspended')
  assert.equal(planInstitutionTransition('suspended', 'reactivate').to, 'active')
  assert.equal(planInstitutionTransition('rejected', 'reopen').to, 'pending')
})
test('institution transitions: every disallowed combination is a 409', () => {
  const all: InstitutionStatus[] = ['pending', 'active', 'suspended', 'rejected']
  const valid = new Set(['pending:approve', 'pending:reject', 'active:suspend', 'suspended:reactivate', 'rejected:reopen'])
  for (const s of all) for (const a of ['approve', 'reject', 'suspend', 'reactivate', 'reopen'] as InstitutionAction[]) {
    if (valid.has(`${s}:${a}`)) continue
    assert.throws(() => planInstitutionTransition(s, a, 'a valid reason'), status(409), `${s}:${a}`)
  }
})
test('institution reject and suspend need a reason of 3+ characters (422); approve does not', () => {
  for (const r of [undefined, '', '  ', 'ab']) {
    assert.throws(() => planInstitutionTransition('pending', 'reject', r), status(422))
    assert.throws(() => planInstitutionTransition('active', 'suspend', r), status(422))
  }
  assert.equal(planInstitutionTransition('pending', 'approve').reason, null)
  assert.equal(planInstitutionTransition('pending', 'reject', '  no licence  ').reason, 'no licence')
})
test('unknown institution action is a 400', () => assert.throws(() => planInstitutionTransition('pending', 'explode' as InstitutionAction), status(400)))

// ---------- programmes ----------
const own = { national: false, isSuperAdmin: false }
const sa = { national: false, isSuperAdmin: true }
const nat = { national: true, isSuperAdmin: true }
test('programme lifecycle: draft -> pending -> active -> archived, and rejected -> pending again', () => {
  assert.equal(planProgrammeTransition('draft', 'submit', own).to, 'pending_approval')
  assert.equal(planProgrammeTransition('pending_approval', 'approve', sa).to, 'active')
  assert.equal(planProgrammeTransition('active', 'archive', own).to, 'archived')
  assert.equal(planProgrammeTransition('pending_approval', 'reject', { ...sa, reason: 'syllabus missing' }).to, 'rejected')
  assert.equal(planProgrammeTransition('rejected', 'submit', own).to, 'pending_approval')
})
test('only a super admin approves or rejects (403), and only a national programme can be approved from draft', () => {
  assert.throws(() => planProgrammeTransition('pending_approval', 'approve', own), status(403))
  assert.throws(() => planProgrammeTransition('pending_approval', 'reject', { ...own, reason: 'nope nope' }), status(403))
  assert.equal(planProgrammeTransition('draft', 'approve', nat).to, 'active')
  assert.throws(() => planProgrammeTransition('draft', 'approve', sa), status(409)) // institution programme must be submitted first
})
test('programme reject needs a reason (422); wrong-state actions are 409', () => {
  assert.throws(() => planProgrammeTransition('pending_approval', 'reject', sa), status(422))
  assert.equal(planProgrammeTransition('pending_approval', 'reject', { ...sa, reason: '  too vague  ' }).reason, 'too vague')
  const all: ProgrammeStatus[] = ['draft', 'pending_approval', 'active', 'archived', 'rejected']
  const valid = new Set(['draft:submit', 'rejected:submit', 'pending_approval:approve', 'pending_approval:reject', 'active:archive'])
  for (const s of all) for (const a of ['submit', 'archive'] as ProgrammeAction[]) {
    if (valid.has(`${s}:${a}`)) continue
    assert.throws(() => planProgrammeTransition(s, a, sa), status(409), `${s}:${a}`)
  }
  assert.throws(() => planProgrammeTransition('active', 'approve', sa), status(409))
  assert.throws(() => planProgrammeTransition('archived', 'reject', { ...sa, reason: 'reason' }), status(409))
})
test('programmes are editable only in draft or rejected', () => {
  assert.deepEqual((['draft', 'pending_approval', 'active', 'archived', 'rejected'] as ProgrammeStatus[]).filter(isProgrammeEditable), ['draft', 'rejected'])
})

// ---------- batches ----------
test('batch transitions: allowed paths and the trainer requirement', () => {
  assert.equal(planBatchTransition('planned', 'ongoing', { hasTrainer: true }), 'ongoing')
  assert.equal(planBatchTransition('planned', 'cancelled', { hasTrainer: false }), 'cancelled')
  assert.equal(planBatchTransition('ongoing', 'completed', { hasTrainer: true }), 'completed')
  assert.equal(planBatchTransition('ongoing', 'cancelled', { hasTrainer: true }), 'cancelled')
  assert.throws(() => planBatchTransition('planned', 'ongoing', { hasTrainer: false }), status(409))
})
test('batch transitions: everything else is a 409, and closed batches are final', () => {
  const all: BatchStatus[] = ['planned', 'ongoing', 'completed', 'cancelled']
  const valid = new Set(['planned:ongoing', 'planned:cancelled', 'ongoing:completed', 'ongoing:cancelled'])
  for (const a of all) for (const b of all) {
    if (valid.has(`${a}:${b}`)) continue
    assert.throws(() => planBatchTransition(a, b, { hasTrainer: true }), status(409), `${a}:${b}`)
  }
  assert.equal(isBatchClosed('completed'), true); assert.equal(isBatchClosed('cancelled'), true); assert.equal(isBatchClosed('planned'), false)
})
test('batch dates: end may equal start but not precede it; malformed and impossible dates are 422 with paths', () => {
  assert.doesNotThrow(() => validateBatchDates('2026-10-01', '2026-10-01'))
  assert.doesNotThrow(() => validateBatchDates('2026-10-01', '2027-03-31'))
  assert.throws(() => validateBatchDates('2026-10-02', '2026-10-01'), status(422))
  let thrown: unknown
  try { validateBatchDates('2026-02-30', 'nope') } catch (e) { thrown = e }
  assert.ok(thrown instanceof AppError, 'expected a validation error')
  assert.deepEqual(((thrown as AppError).details as { issues: Array<{ path: string }> }).issues.map((i) => i.path), ['startDate', 'endDate'])
})
test('batch capacity: positive integers only and never below occupied seats', () => {
  assert.doesNotThrow(() => validateCapacity(30, 30))
  assert.doesNotThrow(() => validateCapacity(1, 0))
  assert.throws(() => validateCapacity(29, 30), status(422))
  for (const bad of [0, -5, 2.5, Number.NaN]) assert.throws(() => validateCapacity(bad, 0), status(422), String(bad))
})
test('CAPACITY_STATUSES is the single seat-counting list, re-exported for Part 4', () => {
  assert.deepEqual([...CAPACITY_STATUSES], ['enrolled', 'in_progress', 'completed'])
  // batches.service.ts needs `pg`, so check the re-export from source text instead of importing it.
  assert.match(readFileSync(new URL('../src/modules/training/batches.service.ts', import.meta.url), 'utf8'), /export \{ CAPACITY_STATUSES \}/)
  assert.equal(capacityStatusesSql(), "'enrolled', 'in_progress', 'completed'")
})

// ---------- institution scoping helpers ----------
test('scopeInstitutionIds: super admin unrestricted unless filtered; others limited to their own; foreign filter is 404', () => {
  assert.equal(scopeInstitutionIds(ctx({ role: 'super_admin', institutionIds: [] })), null)
  assert.deepEqual(scopeInstitutionIds(ctx({ role: 'super_admin', institutionIds: [] }), 'x'), ['x'])
  assert.deepEqual(scopeInstitutionIds(ctx({})), ['i1', 'i2'])
  assert.deepEqual(scopeInstitutionIds(ctx({}), 'i2'), ['i2'])
  assert.throws(() => scopeInstitutionIds(ctx({}), 'other'), status(404))
  assert.deepEqual(scopeInstitutionIds(ctx({ institutionIds: [] })), [])
})
test('resolveInstitutionId: single-institution admins may omit it; multi-institution callers must choose; foreign id is 404', () => {
  assert.equal(resolveInstitutionId(ctx({ institutionIds: ['only'] })), 'only')
  assert.throws(() => resolveInstitutionId(ctx({})), status(422))
  assert.equal(resolveInstitutionId(ctx({}), 'i1'), 'i1')
  assert.throws(() => resolveInstitutionId(ctx({}), 'foreign'), status(404))
  assert.equal(resolveInstitutionId(ctx({ role: 'super_admin', institutionIds: [] }), 'any'), 'any')
  assert.throws(() => resolveInstitutionId(ctx({ role: 'super_admin', institutionIds: [] })), status(422))
})
