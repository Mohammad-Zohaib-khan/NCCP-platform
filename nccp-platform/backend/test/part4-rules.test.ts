import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { AppError } from '../src/lib/errors.js'
import { buildUpdate } from '../src/lib/list-query.js'
import { planEnrolmentTransition, REENROLLABLE, STAFF_ACTIONS, type EnrolmentAction, type EnrolmentStatus } from '../src/modules/learning/enrolments.state.js'
import { isSessionClosed, planSessionTransition, validateSessionMode, validateSessionTimes } from '../src/modules/learning/sessions.state.js'
import { attendancePercent, planSelfCheckIn, SELF_CHECKIN_METHODS } from '../src/modules/learning/attendance.rules.js'
import { assertAttemptAllowed, gradeMcq, isAutoGradable, isPassing, stripAnswerKey, validateAnswers, validateMarks, validateQuestions, type McqQuestion, type Question } from '../src/modules/learning/assessments.rules.js'
import { CAPACITY_STATUSES } from '../src/modules/training/constants.js'

const throwsApp = (fn: () => unknown, status: number) => assert.throws(fn, (e: unknown) => e instanceof AppError && e.statusCode === status)

describe('enrolment state machine', () => {
  const all: EnrolmentStatus[] = ['applied', 'enrolled', 'in_progress', 'completed', 'dropped', 'rejected']
  const actions: EnrolmentAction[] = ['approve', 'reject', 'start', 'complete', 'drop', 'withdraw']
  const allowed: Record<string, string> = {
    'approve:applied': 'enrolled', 'reject:applied': 'rejected', 'start:enrolled': 'in_progress', 'complete:enrolled': 'completed', 'complete:in_progress': 'completed',
    'drop:applied': 'dropped', 'drop:enrolled': 'dropped', 'drop:in_progress': 'dropped', 'withdraw:applied': 'dropped', 'withdraw:enrolled': 'dropped',
  }
  test('every action/status pair behaves exactly as the table says (others are 409)', () => {
    for (const a of actions) for (const s of all) {
      const key = `${a}:${s}`
      if (allowed[key]) assert.equal(planEnrolmentTransition(s, a, { reason: 'because' }), allowed[key], key)
      else throwsApp(() => planEnrolmentTransition(s, a, { reason: 'because' }), 409)
    }
  })
  test('rejecting needs a reason (422)', () => {
    throwsApp(() => planEnrolmentTransition('applied', 'reject'), 422)
    throwsApp(() => planEnrolmentTransition('applied', 'reject', { reason: '   ' }), 422)
  })
  test('completed is terminal; dropped and rejected can be re-enrolled', () => {
    for (const a of actions) throwsApp(() => planEnrolmentTransition('completed', a, { reason: 'x' }), 409)
    assert.deepEqual([...REENROLLABLE].sort(), ['dropped', 'rejected'])
  })
  test('withdraw is the only non-staff action', () => {
    assert.deepEqual(actions.filter((a) => !STAFF_ACTIONS.includes(a)), ['withdraw'])
  })
  test('seat statuses are the ones Part 3 uses', () => assert.deepEqual([...CAPACITY_STATUSES], ['enrolled', 'in_progress', 'completed']))
})

describe('session rules', () => {
  test('transitions', () => {
    assert.equal(planSessionTransition('scheduled', 'live'), 'live')
    assert.equal(planSessionTransition('live', 'completed'), 'completed')
    assert.equal(planSessionTransition('scheduled', 'cancelled'), 'cancelled')
    throwsApp(() => planSessionTransition('completed', 'live'), 409)
    throwsApp(() => planSessionTransition('cancelled', 'scheduled'), 409)
    throwsApp(() => planSessionTransition('live', 'scheduled'), 409)
    assert.ok(isSessionClosed('completed') && isSessionClosed('cancelled') && !isSessionClosed('live'))
  })
  test('times must be valid, ordered and at most 12 hours', () => {
    validateSessionTimes('2026-11-02T04:00:00Z', '2026-11-02T06:00:00Z')
    throwsApp(() => validateSessionTimes('nope', '2026-11-02T06:00:00Z'), 422)
    throwsApp(() => validateSessionTimes('2026-11-02T06:00:00Z', '2026-11-02T06:00:00Z'), 422)
    throwsApp(() => validateSessionTimes('2026-11-02T06:00:00Z', '2026-11-02T05:00:00Z'), 422)
    throwsApp(() => validateSessionTimes('2026-11-02T00:00:00Z', '2026-11-02T12:00:01Z'), 422)
  })
  test('online sessions need a join link', () => {
    validateSessionMode('offline', null); validateSessionMode('online', 'https://meet.example/x')
    throwsApp(() => validateSessionMode('online', null), 422)
  })
})

describe('attendance rules', () => {
  const start = Date.parse('2026-11-02T04:00:00Z'); const end = Date.parse('2026-11-02T06:00:00Z'); const min = 60_000
  test('self check-in window and late marking', () => {
    throwsApp(() => planSelfCheckIn(start, end, start - 16 * min), 409)
    assert.equal(planSelfCheckIn(start, end, start - 15 * min), 'present')
    assert.equal(planSelfCheckIn(start, end, start + 15 * min), 'present')
    assert.equal(planSelfCheckIn(start, end, start + 15 * min + 1), 'late')
    assert.equal(planSelfCheckIn(start, end, end - 1), 'late')
    throwsApp(() => planSelfCheckIn(start, end, end), 409)
  })
  test('trainees cannot claim qr, fingerprint or face through plain check-in', () => assert.deepEqual([...SELF_CHECKIN_METHODS].sort(), ['manual', 'online']))
  test('attendance percentage: late counts, excused leaves the denominator, nothing counted is null', () => {
    assert.equal(attendancePercent({ present: 6, late: 2, absent: 2, excused: 0, counted: 10 }), 80)
    assert.equal(attendancePercent({ present: 6, late: 0, absent: 0, excused: 2, counted: 10 }), 75)
    assert.equal(attendancePercent({ present: 0, late: 0, absent: 0, excused: 0, counted: 0 }), null)
    assert.equal(attendancePercent({ present: 0, late: 0, absent: 0, excused: 3, counted: 3 }), null)
    assert.equal(attendancePercent({ present: 1, late: 0, absent: 2, excused: 0, counted: 3 }), 33.33)
  })
})

describe('assessment rules', () => {
  const mcq = (id: string, marks: number, correct = 'b'): McqQuestion => ({ id, type: 'mcq', prompt: 'Q', marks, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionId: correct })
  const text = (id: string, marks: number): Question => ({ id, type: 'text', prompt: 'Explain', marks })

  test('question marks must add up to totalMarks (float safe); no questions is allowed', () => {
    validateQuestions([], 100)
    validateQuestions([mcq('q1', 0.1), mcq('q2', 0.2)], 0.3)
    validateQuestions([mcq('q1', 5), text('q2', 5)], 10)
    throwsApp(() => validateQuestions([mcq('q1', 5)], 10), 422)
  })
  test('rejects duplicate ids, a missing correct option, duplicate option ids and single-option questions', () => {
    throwsApp(() => validateQuestions([mcq('q1', 5), mcq('q1', 5)], 10), 422)
    throwsApp(() => validateQuestions([mcq('q1', 5, 'zzz')], 5), 422)
    throwsApp(() => validateQuestions([{ ...mcq('q1', 5), options: [{ id: 'a', text: 'A' }, { id: 'a', text: 'B' }] }], 5), 422)
    throwsApp(() => validateQuestions([{ ...mcq('q1', 5), options: [{ id: 'b', text: 'B' }] }], 5), 422)
  })
  test('pass marks cannot exceed total', () => { validateMarks(10, 10); throwsApp(() => validateMarks(10, 10.01), 422) })
  test('auto grading only when every question is multiple choice', () => {
    assert.equal(isAutoGradable([mcq('q1', 5), mcq('q2', 5)]), true)
    assert.equal(isAutoGradable([mcq('q1', 5), text('q2', 5)]), false)
    assert.equal(isAutoGradable([]), false)
  })
  test('grading and pass mark', () => {
    const qs = [mcq('q1', 5), mcq('q2', 5), mcq('q3', 2.5, 'a')]
    assert.equal(gradeMcq(qs, { q1: 'b', q2: 'a', q3: 'a' }), 7.5)
    assert.equal(gradeMcq(qs, {}), 0)
    assert.equal(isPassing(7.5, 7.5), true); assert.equal(isPassing(7.49, 7.5), false)
  })
  test('answers are validated against the questions', () => {
    const qs = [mcq('q1', 5), text('q2', 5)]
    validateAnswers(qs, { q1: 'a', q2: 'free text' }); validateAnswers(qs, {})
    throwsApp(() => validateAnswers(qs, { nope: 'a' }), 422)
    throwsApp(() => validateAnswers(qs, { q1: 'c' }), 422)
    throwsApp(() => validateAnswers(qs, { q1: 5 }), 422)
    throwsApp(() => validateAnswers(qs, { q2: 'x'.repeat(10_001) }), 422)
  })
  test('the answer key never reaches trainees', () => {
    const shown = stripAnswerKey([mcq('q1', 5), text('q2', 5)])
    assert.ok(!JSON.stringify(shown).includes('correctOptionId'))
    assert.equal(shown.length, 2)
  })
  test('attempt limits, window and status', () => {
    const base = { status: 'published', opensAt: null, dueAt: null, maxAttempts: 2, attemptsUsed: 0 }
    assertAttemptAllowed(base); assertAttemptAllowed({ ...base, attemptsUsed: 1 })
    throwsApp(() => assertAttemptAllowed({ ...base, attemptsUsed: 2 }), 409)
    throwsApp(() => assertAttemptAllowed({ ...base, status: 'draft' }), 409)
    throwsApp(() => assertAttemptAllowed({ ...base, status: 'closed' }), 409)
    const now = new Date('2026-11-10T00:00:00Z')
    throwsApp(() => assertAttemptAllowed({ ...base, opensAt: new Date('2026-11-11T00:00:00Z') }, now), 409)
    throwsApp(() => assertAttemptAllowed({ ...base, dueAt: new Date('2026-11-09T00:00:00Z') }, now), 409)
    assertAttemptAllowed({ ...base, opensAt: new Date('2026-11-09T00:00:00Z'), dueAt: new Date('2026-11-11T00:00:00Z') }, now)
  })
})

describe('buildUpdate for tables without deleted_at', () => {
  test('default keeps the deleted_at guard, softDeleted:false drops it', () => {
    assert.match(buildUpdate({ table: 'batches', id: 'i', expectedVersion: 1, sets: { code: 'x' } }).sql, /deleted_at IS NULL/)
    const sql = buildUpdate({ table: 'class_sessions', id: 'i', expectedVersion: 1, sets: { title: 'x' }, softDeleted: false }).sql
    assert.doesNotMatch(sql, /deleted_at/)
    assert.match(sql, /WHERE id = \$1 AND version = \$2 RETURNING/)
  })
})
