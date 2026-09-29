import { AppError } from '../../lib/errors.js'

export interface McqQuestion { id: string; type: 'mcq'; prompt: string; marks: number; options: Array<{ id: string; text: string }>; correctOptionId: string }
export interface TextQuestion { id: string; type: 'text'; prompt: string; marks: number }
export type Question = McqQuestion | TextQuestion

/** Marks are stored as numeric(6,2); compare with cents-style rounding so 0.1 + 0.2 does not break the total check. */
const round2 = (n: number): number => Math.round(n * 100) / 100

export function validateQuestions(questions: Question[], totalMarks: number): void {
  const ids = new Set<string>()
  let sum = 0
  questions.forEach((q, i) => {
    if (ids.has(q.id)) throw AppError.validation([{ path: `questions.${i}.id`, message: `Duplicate question id ${q.id}` }])
    ids.add(q.id)
    sum += q.marks
    if (q.type === 'mcq') {
      const optIds = new Set(q.options.map((o) => o.id))
      if (optIds.size !== q.options.length) throw AppError.validation([{ path: `questions.${i}.options`, message: 'Option ids must be unique' }])
      if (q.options.length < 2) throw AppError.validation([{ path: `questions.${i}.options`, message: 'A multiple-choice question needs at least two options' }])
      if (!optIds.has(q.correctOptionId)) throw AppError.validation([{ path: `questions.${i}.correctOptionId`, message: 'correctOptionId must be one of the options' }])
    }
  })
  if (questions.length > 0 && round2(sum) !== round2(totalMarks))
    throw AppError.validation([{ path: 'questions', message: `Question marks add up to ${round2(sum)} but totalMarks is ${round2(totalMarks)}` }])
}

export function validateMarks(totalMarks: number, passMarks: number): void {
  if (passMarks > totalMarks) throw AppError.validation([{ path: 'passMarks', message: 'passMarks cannot exceed totalMarks' }])
}

/** True when every question can be marked by the server, so a submission is graded immediately. */
export const isAutoGradable = (questions: Question[]): boolean => questions.length > 0 && questions.every((q) => q.type === 'mcq')

/** Check submitted answers against the questions (answers are keyed by question id). */
export function validateAnswers(questions: Question[], answers: Record<string, unknown>): void {
  const byId = new Map(questions.map((q) => [q.id, q]))
  for (const [qid, ans] of Object.entries(answers)) {
    const q = byId.get(qid)
    if (!q) throw AppError.validation([{ path: `answers.${qid}`, message: 'Unknown question id' }])
    if (typeof ans !== 'string') throw AppError.validation([{ path: `answers.${qid}`, message: 'Answer must be text' }])
    if (q.type === 'mcq' && !q.options.some((o) => o.id === ans)) throw AppError.validation([{ path: `answers.${qid}`, message: 'Not one of the options' }])
    if (q.type === 'text' && ans.length > 10_000) throw AppError.validation([{ path: `answers.${qid}`, message: 'Answer is too long' }])
  }
}

export function gradeMcq(questions: Question[], answers: Record<string, unknown>): number {
  let score = 0
  for (const q of questions) if (q.type === 'mcq' && answers[q.id] === q.correctOptionId) score += q.marks
  return round2(score)
}
export const isPassing = (score: number, passMarks: number): boolean => round2(score) >= round2(passMarks)

/** Trainees must never receive the answer key. */
export function stripAnswerKey(questions: Question[]): Array<Omit<McqQuestion, 'correctOptionId'> | TextQuestion> {
  return questions.map((q) => {
    if (q.type !== 'mcq') return q
    const { correctOptionId: _drop, ...rest } = q
    return rest
  })
}

export function assertAttemptAllowed(a: { status: string; opensAt: Date | null; dueAt: Date | null; maxAttempts: number; attemptsUsed: number }, now = new Date()): void {
  if (a.status !== 'published') throw AppError.conflict('This assessment is not open for attempts')
  if (a.opensAt && now < a.opensAt) throw AppError.conflict('This assessment has not opened yet')
  if (a.dueAt && now > a.dueAt) throw AppError.conflict('The due date for this assessment has passed')
  if (a.attemptsUsed >= a.maxAttempts) throw AppError.conflict('No attempts left for this assessment', { maxAttempts: a.maxAttempts })
}
