import { shared } from '../lib/plugin.js'
import type { FastifyInstance } from 'fastify'

/** Adds X-Request-Id to every response and enriches the request-scoped logger. */
async function requestContextImpl(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id)
  })
}

export const requestContext = shared(requestContextImpl)
