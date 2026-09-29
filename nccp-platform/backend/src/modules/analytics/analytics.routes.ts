import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import { actorOf } from '../../lib/http.js'
import { isSuperAdmin, assertInstitutionAccess, assertEmployerAccess } from '../../auth/context.js'
import { AppError } from '../../lib/errors.js'
import type { AnalyticsService } from './analytics.service.js'

const uuid = z.string().uuid()

export interface AnalyticsRouteDeps {
  config: AppConfig
  service: AnalyticsService
}

export async function analyticsRoutes(app: FastifyInstance, deps: AnalyticsRouteDeps): Promise<void> {
  const { service } = deps

  // Workspace-adapted dashboard for the authenticated caller
  app.get('/analytics/dashboard', { preHandler: app.authorize('analytics:read') }, async (req) => {
    return service.getDashboard(actorOf(req))
  })

  // National metrics (super_admin only)
  app.get('/analytics/national', { preHandler: app.authorize('analytics:read') }, async (req) => {
    const actor = actorOf(req)
    if (!isSuperAdmin(actor)) throw AppError.forbidden()
    return service.getNationalDashboard()
  })

  // Specific institution metrics
  app.get('/analytics/institution/:id', { preHandler: app.authorize('analytics:read') }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const actor = actorOf(req)
    assertInstitutionAccess(actor, id, 'Institution')
    return service.getInstitutionDashboard([id])
  })

  // Specific employer recruitment funnel metrics
  app.get('/analytics/employer/:id', { preHandler: app.authorize('analytics:read') }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params)
    const actor = actorOf(req)
    assertEmployerAccess(actor, id, 'Employer')
    return service.getEmployerDashboard([id])
  })
}
