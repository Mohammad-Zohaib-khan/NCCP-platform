import { shared } from '../lib/plugin.js'
import type { FastifyInstance } from 'fastify'
import { normaliseError } from '../lib/errors.js'

async function errorHandlerImpl(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err, req, reply) => {
    const out = normaliseError(err, req.id)
    if (out.log === 'error') req.log.error({ err }, 'unhandled error')
    else req.log.warn({ code: out.body.error.code, status: out.statusCode }, err instanceof Error ? err.message : 'request error')
    void reply.status(out.statusCode).send(out.body)
  })

  app.setNotFoundHandler((req, reply) => {
    const out = normaliseError({ statusCode: 404, message: `Route ${req.method} ${req.url.split('?')[0]} not found` }, req.id)
    void reply.status(404).send(out.body)
  })
}

export const errorHandler = shared(errorHandlerImpl)
