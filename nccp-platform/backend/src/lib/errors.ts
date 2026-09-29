/**
 * Consistent error model. Every failure leaving the API is serialised as:
 * { "error": { "code", "message", "requestId", "details?" } }
 */
export type ErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'CONFLICT' | 'PRECONDITION_FAILED' | 'IDEMPOTENCY_CONFLICT' | 'PAYLOAD_TOO_LARGE'
  | 'ACCOUNT_LOCKED' | 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE' | 'INTERNAL'

export interface FieldIssue { path: string; message: string; code?: string }

export class AppError extends Error {
  readonly statusCode: number
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }

  static badRequest(message = 'Bad request', details?: unknown) { return new AppError(400, 'BAD_REQUEST', message, details) }
  static validation(issues: FieldIssue[], message = 'Request validation failed') { return new AppError(422, 'VALIDATION_ERROR', message, { issues }) }
  static unauthenticated(message = 'Authentication required') { return new AppError(401, 'UNAUTHENTICATED', message) }
  static forbidden(message = 'You do not have permission to perform this action') { return new AppError(403, 'FORBIDDEN', message) }
  static notFound(resource = 'Resource') { return new AppError(404, 'NOT_FOUND', `${resource} not found`) }
  static conflict(message = 'Conflict', details?: unknown) { return new AppError(409, 'CONFLICT', message, details) }
  static preconditionFailed(message = 'The record was modified by someone else; reload and retry') { return new AppError(412, 'PRECONDITION_FAILED', message) }
  static locked(message = 'Account temporarily locked') { return new AppError(423, 'ACCOUNT_LOCKED', message) }
  static unavailable(message = 'Service unavailable') { return new AppError(503, 'SERVICE_UNAVAILABLE', message) }
}

export interface ErrorBody { error: { code: ErrorCode; message: string; requestId: string; details?: unknown } }

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT',
  412: 'PRECONDITION_FAILED', 423: 'ACCOUNT_LOCKED', 413: 'PAYLOAD_TOO_LARGE', 422: 'VALIDATION_ERROR', 429: 'RATE_LIMITED', 503: 'SERVICE_UNAVAILABLE',
}

// Duck-typed so this module has no framework dependency (and is unit-testable without installs).
function isZodLike(err: unknown): err is { issues: Array<{ path: Array<string | number>; message: string; code?: string }> } {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ZodError' && Array.isArray((err as { issues?: unknown }).issues)
}
function hasStatus(err: unknown): err is { statusCode: number; message: string; validation?: Array<{ instancePath?: string; message?: string; keyword?: string }> } {
  return typeof err === 'object' && err !== null && typeof (err as { statusCode?: unknown }).statusCode === 'number'
}

export interface NormalisedError { statusCode: number; body: ErrorBody; log: 'warn' | 'error' }

/** Convert any thrown value into a safe HTTP response. Never leaks internals for 5xx. */
export function normaliseError(err: unknown, requestId: string): NormalisedError {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      log: err.statusCode >= 500 ? 'error' : 'warn',
      body: { error: { code: err.code, message: err.message, requestId, ...(err.details !== undefined ? { details: err.details } : {}) } },
    }
  }
  if (isZodLike(err)) {
    const issues: FieldIssue[] = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }))
    return { statusCode: 422, log: 'warn', body: { error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId, details: { issues } } } }
  }
  if (hasStatus(err) && err.statusCode >= 400 && err.statusCode < 500) {
    if (Array.isArray(err.validation)) {
      const issues: FieldIssue[] = err.validation.map((v) => ({ path: (v.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.'), message: v.message ?? 'invalid', code: v.keyword }))
      return { statusCode: 422, log: 'warn', body: { error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId, details: { issues } } } }
    }
    const code = STATUS_TO_CODE[err.statusCode] ?? 'BAD_REQUEST'
    return { statusCode: err.statusCode, log: 'warn', body: { error: { code, message: err.message, requestId } } }
  }
  return { statusCode: 500, log: 'error', body: { error: { code: 'INTERNAL', message: 'An unexpected error occurred', requestId } } }
}
