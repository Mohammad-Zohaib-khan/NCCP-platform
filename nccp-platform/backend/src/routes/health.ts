import type { FastifyInstance } from 'fastify'
import type { Db } from '../db/pool.js'

export interface HealthDeps { db: Db; version: string }

/**
 * /healthz  – liveness: process is up (no dependencies checked, so a DB outage never restarts the container).
 * /readyz   – readiness: database reachable; load balancers use this to route traffic.
 */
export async function healthRoutes(app: FastifyInstance, deps: HealthDeps): Promise<void> {
  const startedAt = Date.now()

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    version: deps.version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }))

  app.get('/readyz', { config: { rateLimit: false } }, async (_req, reply) => {
    const started = process.hrtime.bigint()
    try {
      await deps.db.query('SELECT 1')
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      return { status: 'ready', checks: { database: { status: 'up', latencyMs: Math.round(ms * 10) / 10 } } }
    } catch {
      return reply.status(503).send({ status: 'not_ready', checks: { database: { status: 'down' } } })
    }
  })
}
