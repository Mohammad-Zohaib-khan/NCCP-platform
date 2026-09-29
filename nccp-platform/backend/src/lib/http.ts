import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AppConfig } from '../config/env.js'
import type { AuthContext } from '../auth/context.js'
import { AppError } from './errors.js'
import type { ReqInfo } from '../modules/auth/service.js'

/** Request metadata recorded on audit rows. */
export const reqInfo = (req: FastifyRequest): ReqInfo => ({ ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id })

/** The authenticated caller; throws 401 if a route forgot its auth pre-handler (fails closed). */
export function actorOf(req: FastifyRequest): AuthContext {
  if (!req.auth) throw AppError.unauthenticated()
  return req.auth
}

/** Parse `If-Match: "3"` / `W/"3"` / `3` into the expected record version. */
export function parseIfMatch(raw: unknown): number {
  const text = String(raw ?? '').replace(/^W\//, '').replace(/"/g, '').trim()
  const n = Number(text)
  if (!text || !Number.isInteger(n) || n < 1) throw AppError.badRequest('If-Match header with the current record version is required')
  return n
}
export const ifMatch = (req: FastifyRequest): number => parseIfMatch(req.headers['if-match'])

/** Set the ETag header from the record's version and return the body unchanged. */
export function versioned<T extends { version: number }>(reply: FastifyReply, body: T): T {
  reply.header('etag', `"${body.version}"`)
  return body
}

/** Per-route rate limit; effectively disabled when NODE_ENV=test so suites can call endpoints repeatedly. */
export function limit(config: Pick<AppConfig, 'env'>, max: number, window = '1 minute') {
  return { rateLimit: { max: config.env === 'test' ? 100_000 : max, timeWindow: window } }
}
