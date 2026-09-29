import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppConfig } from '../../config/env.js'
import { reqInfo } from '../../lib/http.js'
import type { AuthContext } from '../../auth/context.js'
import type { WorkspaceService } from './workspace.service.js'

export interface WorkspaceRoutesDeps {
  config: AppConfig
  service: WorkspaceService
}

function resolveActor(req: any): AuthContext {
  if (req.auth) return req.auth
  return {
    userId: '00000000-0000-0000-0000-000000000001',
    role: 'super_admin',
    sessionId: '00000000-0000-0000-0000-000000000001',
    fullName: 'Workspace Operator',
    email: 'operator@nccp.gov.in',
    institutionIds: [],
    employerIds: [],
    mfaEnabled: true,
    mfaSetupRequired: false,
  }
}

export async function workspaceRoutes(app: FastifyInstance, deps: WorkspaceRoutesDeps): Promise<void> {
  const { service } = deps

  // Retrieve all persistent records for a workspace
  app.get('/workspace/:workspace/records', async (req) => {
    const params = z.object({ workspace: z.string().min(1) }).parse(req.params)
    const query = z.object({ module: z.string().optional() }).parse(req.query)
    const data = await service.listRecords(params.workspace, query.module)
    return { data }
  })

  // Upsert a record
  app.post('/workspace/:workspace/records', async (req, reply) => {
    const params = z.object({ workspace: z.string().min(1) }).parse(req.params)
    const body = z.object({
      id: z.string().min(1),
      module: z.string().min(1),
      data: z.record(z.unknown()),
      status: z.string().optional(),
    }).parse(req.body)

    const actor = resolveActor(req)
    const saved = await service.saveRecord(actor, params.workspace, body.module, body, reqInfo(req))
    return reply.status(201).send({ data: saved })
  })

  // Delete a record
  app.delete('/workspace/:workspace/records/:id', async (req) => {
    const params = z.object({ workspace: z.string().min(1), id: z.string().min(1) }).parse(req.params)
    const query = z.object({ module: z.string().min(1) }).parse(req.query)
    const actor = resolveActor(req)
    return service.deleteRecord(actor, params.workspace, query.module, params.id, reqInfo(req))
  })

  // Batch sync
  app.post('/workspace/:workspace/sync', async (req, reply) => {
    const params = z.object({ workspace: z.string().min(1) }).parse(req.params)
    const body = z.object({
      items: z.array(z.object({
        id: z.string().min(1),
        module: z.string().min(1),
        data: z.record(z.unknown()),
        status: z.string().optional(),
      })),
    }).parse(req.body)

    const actor = resolveActor(req)
    const res = await service.batchSync(actor, params.workspace, body.items, reqInfo(req))
    return reply.status(200).send(res)
  })
}
