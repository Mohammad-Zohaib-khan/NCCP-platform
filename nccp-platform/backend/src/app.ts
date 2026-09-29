import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import cookie from '@fastify/cookie'
import type { AppConfig } from './config/env.js'
import type { Db } from './db/pool.js'
import { loggerOptions } from './lib/logger.js'
import { resolveRequestId } from './lib/request-id.js'
import { requestContext } from './plugins/request-context.js'
import { errorHandler } from './plugins/error-handler.js'
import { authPlugin } from './plugins/auth.js'
import { createMailer, type Mailer } from './lib/mailer.js'
import { healthRoutes } from './routes/health.js'
import { v1Routes } from './routes/v1.js'

export const APP_VERSION = process.env.APP_VERSION ?? '0.1.0'

export interface BuildDeps { config: AppConfig; db: Db; mailer?: Mailer }

export async function buildApp({ config, db, mailer }: BuildDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.trustProxy,
    bodyLimit: 1_048_576, // 1 MiB for JSON; file uploads get their own limits in the files module
    genReqId: (req) => resolveRequestId(req.headers['x-request-id']),
    requestIdLogLabel: 'requestId',
    disableRequestLogging: false,
  })

  await app.register(helmet, {
    // API returns JSON only; a strict CSP is safe and blocks any accidental HTML rendering.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  })

  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser clients send no Origin header; browsers must match the allow-list exactly.
      if (!origin || config.frontendOrigins.includes(origin)) return cb(null, true)
      return cb(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', 'If-Match', 'X-Requested-With'],
    exposedHeaders: ['X-Request-Id', 'ETag'],
    maxAge: 600,
  })

  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    errorResponseBuilder: (req, ctx) => ({
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: `Too many requests; retry in ${Math.ceil(ctx.ttl / 1000)}s`, requestId: req.id },
    }),
  })

  await app.register(cookie, { secret: config.auth.cookieSecret })
  await app.register(requestContext)
  await app.register(errorHandler)
  await app.register(healthRoutes, { db, version: APP_VERSION })
  await app.register(authPlugin, { db, config })
  const mail = mailer ?? createMailer({ production: config.env === 'production' || config.env === 'staging', log: app.log })
  await app.register(v1Routes, { prefix: '/api/v1', config, db, mailer: mail })

  return app
}
