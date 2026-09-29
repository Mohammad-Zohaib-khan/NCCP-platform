import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { parsePageParams } from '../../lib/pagination.js'
import { ROLE_CODES } from '../../auth/permissions.js'
import type { AuthContext } from '../../auth/context.js'
import type { AuthService, ReqInfo, TokenPair } from './service.js'
import type { UsersService } from './users.service.js'

const REFRESH_COOKIE = 'nccp_rt'
const COOKIE_PATH = '/api/v1/auth'
const email = z.string().trim().toLowerCase().email().max(254)
const password = z.string().min(1).max(128)
const uuid = z.string().uuid()

const info = (req: FastifyRequest): ReqInfo => ({ ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id })
const actor = (req: FastifyRequest): AuthContext => { if (!req.auth) throw AppError.unauthenticated(); return req.auth }

/** Parse `If-Match: "3"` / `If-Match: 3` into the expected record version. */
function ifMatch(req: FastifyRequest): number {
  const raw = String(req.headers['if-match'] ?? '').replace(/^W\//, '').replace(/"/g, '')
  const n = Number(raw)
  if (!raw || !Number.isInteger(n) || n < 1) throw AppError.badRequest('If-Match header with the current record version is required')
  return n
}

export interface AuthRouteDeps { config: AppConfig; auth: AuthService; users: UsersService }

export async function authRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  const { config, auth, users } = deps
  // Per-route limits protect credential endpoints; relaxed under NODE_ENV=test so suites can log in repeatedly.
  const strictLimit = (max: number, window = '1 minute') => ({ rateLimit: { max: config.env === 'test' ? 100_000 : max, timeWindow: window } })

  const setRefreshCookie = (reply: FastifyReply, t: TokenPair) =>
    reply.setCookie(REFRESH_COOKIE, t.refreshToken, { httpOnly: true, secure: config.auth.cookieSecure, sameSite: config.auth.cookieSameSite, path: COOKIE_PATH, expires: t.refreshExpiresAt })
  const clearRefreshCookie = (reply: FastifyReply) => reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH })
  const sessionBody = (t: TokenPair) => ({ accessToken: t.accessToken, tokenType: 'Bearer', expiresIn: t.expiresIn })

  /**
   * CSRF defence for endpoints that authenticate with the refresh cookie: require a custom header (which browsers
   * only send cross-origin after a CORS preflight, and our allow-list rejects foreign origins) and, when an Origin
   * header is present, that it is on the allow-list.
   */
  function csrfGuard(req: FastifyRequest): void {
    if (req.headers['x-requested-with'] !== 'nccp-web') throw AppError.forbidden('Missing CSRF header')
    const origin = req.headers.origin
    if (origin && !config.frontendOrigins.includes(origin)) throw AppError.forbidden('Origin not allowed')
  }

  // ---------- public auth endpoints (strictly rate-limited) ----------
  app.post('/auth/login', { config: strictLimit(10) }, async (req, reply) => {
    const body = z.object({ email, password }).parse(req.body)
    const result = await auth.login(body.email, body.password, info(req))
    reply.header('cache-control', 'no-store')
    if (result.status === 'mfa_required') return { status: 'mfa_required', challengeToken: result.challengeToken, expiresIn: result.expiresIn }
    setRefreshCookie(reply, result.tokens)
    return { status: 'authenticated', ...sessionBody(result.tokens), user: result.user }
  })

  app.post('/auth/mfa/verify', { config: strictLimit(10) }, async (req, reply) => {
    const body = z.object({ challengeToken: z.string().min(20).max(200), code: z.string().min(6).max(20) }).parse(req.body)
    const result = await auth.verifyMfaLogin(body.challengeToken, body.code, info(req))
    reply.header('cache-control', 'no-store')
    if (result.status !== 'authenticated') throw AppError.unauthenticated()
    setRefreshCookie(reply, result.tokens)
    return { status: 'authenticated', ...sessionBody(result.tokens), user: result.user }
  })

  app.post('/auth/refresh', { config: strictLimit(30) }, async (req, reply) => {
    csrfGuard(req)
    const token = req.cookies[REFRESH_COOKIE]
    if (!token) throw AppError.unauthenticated('Session expired; sign in again')
    try {
      const { tokens, user } = await auth.refresh(token, info(req))
      setRefreshCookie(reply, tokens)
      reply.header('cache-control', 'no-store')
      return { ...sessionBody(tokens), user }
    } catch (err) {
      clearRefreshCookie(reply)
      throw err
    }
  })

  app.post('/auth/logout', { config: strictLimit(30) }, async (req, reply) => {
    csrfGuard(req)
    const token = req.cookies[REFRESH_COOKIE]
    if (token) await auth.logoutByRefreshToken(token)
    clearRefreshCookie(reply)
    return reply.status(204).send()
  })

  app.post('/auth/accept-invite', { config: strictLimit(10) }, async (req, reply) => {
    const body = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(128) }).parse(req.body)
    await auth.acceptInvitation(body.token, body.password, info(req))
    return reply.status(204).send()
  })

  app.post('/auth/forgot-password', { config: strictLimit(5, '15 minutes') }, async (req, reply) => {
    const body = z.object({ email }).parse(req.body)
    await auth.forgotPassword(body.email, info(req)).catch((err) => req.log.error({ err }, 'forgot-password failed')) // never reveal failures
    return reply.status(202).send({ message: 'If an account exists for that email, a reset link has been sent.' })
  })

  app.post('/auth/reset-password', { config: strictLimit(10, '15 minutes') }, async (req, reply) => {
    const body = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(128) }).parse(req.body)
    await auth.resetPassword(body.token, body.password, info(req))
    return reply.status(204).send()
  })

  app.post('/auth/verify-email', { config: strictLimit(10, '15 minutes') }, async (req, reply) => {
    const body = z.object({ token: z.string().min(20).max(200) }).parse(req.body)
    await auth.verifyEmail(body.token, info(req))
    return reply.status(204).send()
  })

  // ---------- authenticated self-service ----------
  app.get('/auth/me', { config: { allowMfaSetup: true }, preHandler: app.authenticate }, async (req, reply) => {
    const a = actor(req)
    reply.header('cache-control', 'no-store')
    return { user: auth.publicUserFromContext(a) }
  })

  app.get('/auth/sessions', { preHandler: app.authorize('sessions:read_own') }, async (req) => {
    const a = actor(req)
    return { data: await auth.listSessions(a.userId, a.sessionId) }
  })

  app.delete('/auth/sessions/:id', { preHandler: app.authorize('sessions:revoke_own') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    await auth.revokeSession(actor(req), id, info(req))
    return reply.status(204).send()
  })

  app.post('/auth/change-password', { config: strictLimit(5, '15 minutes'), preHandler: app.authenticate }, async (req, reply) => {
    const body = z.object({ currentPassword: password, newPassword: password }).parse(req.body)
    await auth.changePassword(actor(req), body.currentPassword, body.newPassword, info(req))
    return reply.status(204).send()
  })

  app.post('/auth/mfa/setup', { config: { allowMfaSetup: true, ...strictLimit(5, '15 minutes') }, preHandler: app.authenticate }, async (req) => auth.beginMfaSetup(actor(req)))

  app.post('/auth/mfa/confirm', { config: { allowMfaSetup: true, ...strictLimit(10, '15 minutes') }, preHandler: app.authenticate }, async (req) => {
    const body = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }).parse(req.body)
    return auth.confirmMfaSetup(actor(req), body.code, info(req))
  })

  app.post('/auth/mfa/disable', { config: strictLimit(5, '15 minutes'), preHandler: app.authenticate }, async (req, reply) => {
    const body = z.object({ password, code: z.string().min(6).max(20) }).parse(req.body)
    await auth.disableMfa(actor(req), body.password, body.code, info(req))
    return reply.status(204).send()
  })

  // ---------- users ----------
  app.get('/users', { preHandler: app.authorize('users:read') }, async (req) => {
    const q = z.object({ q: z.string().max(100).optional(), role: z.enum(ROLE_CODES).optional(), status: z.enum(['invited', 'pending_verification', 'active', 'locked', 'disabled']).optional() }).parse(req.query)
    return users.list(actor(req), q, parsePageParams(req.query as Record<string, unknown>))
  })

  app.get('/users/:id', { preHandler: app.authorize('users:read') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const u = await users.get(actor(req), id)
    reply.header('etag', `"${u.version}"`)
    return u
  })

  app.post('/users/invite', { config: strictLimit(30), preHandler: app.authorize('users:invite') }, async (req, reply) => {
    const body = z.object({
      email, fullName: z.string().trim().min(2).max(120), phone: z.string().trim().max(20).optional(),
      role: z.enum(ROLE_CODES), institutionId: uuid.optional(), employerId: uuid.optional(),
    }).strict().parse(req.body)
    const out = await users.invite(actor(req), body, info(req))
    return reply.status(201).send(out)
  })

  app.post('/users/:id/resend-invitation', { config: strictLimit(20), preHandler: app.authorize('users:invite') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    await users.get(actor(req), id) // scope check first
    await auth.resendInvitation(id, actor(req), info(req))
    return reply.status(204).send()
  })

  app.patch('/users/:id', { preHandler: app.authorize('users:update') }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const patch = z.object({ fullName: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().max(20).nullable().optional() }).strict()
      .refine((p) => Object.keys(p).length > 0, 'Provide at least one field').parse(req.body)
    const u = await users.update(actor(req), id, patch, ifMatch(req), info(req))
    reply.header('etag', `"${u.version}"`)
    return u
  })

  app.post('/users/:id/disable', { preHandler: app.authorize('users:disable') }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    return users.setDisabled(actor(req), id, true, info(req))
  })
  app.post('/users/:id/enable', { preHandler: app.authorize('users:disable') }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    return users.setDisabled(actor(req), id, false, info(req))
  })
  app.post('/users/:id/revoke-sessions', { preHandler: app.authorize('sessions:revoke_any') }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    return { revoked: await users.revokeAllSessions(actor(req), id, info(req)) }
  })

  app.get('/roles', { preHandler: app.authorize('roles:read') }, async () => ({ data: await users.listRoles() }))
}
