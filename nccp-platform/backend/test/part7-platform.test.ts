import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Db } from '../src/db/pool.js'
import type { AuthContext } from '../src/auth/context.js'
import { AppError } from '../src/lib/errors.js'
import { createFilesService } from '../src/modules/platform/files.service.js'
import { createAnnouncementsService } from '../src/modules/platform/announcements.service.js'
import { createNotificationsService } from '../src/modules/platform/notifications.service.js'
import { createSettingsService } from '../src/modules/platform/settings.service.js'
import { createAuditService } from '../src/modules/platform/audit.service.js'

const superAdmin: AuthContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  role: 'super_admin',
  sessionId: 'sess-1',
  fullName: 'Super Admin',
  email: 'admin@nccp.gov.in',
  institutionIds: [],
  employerIds: [],
  mfaEnabled: true,
  mfaSetupRequired: false,
}

const traineeActor: AuthContext = {
  userId: '00000000-0000-4000-8000-000000000003',
  role: 'trainee',
  sessionId: 'sess-3',
  fullName: 'Trainee User',
  email: 'trainee@gmail.com',
  institutionIds: ['inst-1'],
  employerIds: [],
  mfaEnabled: false,
  mfaSetupRequired: false,
}

const reqInfo = { ip: '127.0.0.1', userAgent: 'test-agent', requestId: 'test-req-plat' }

describe('Platform Services: Files', () => {
  test('rejects payload exceeding 25 MB with 413', async () => {
    const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db
    const svc = createFilesService(fakeDb)
    const largeBuffer = { length: 26 * 1024 * 1024 } as unknown as Buffer

    await assert.rejects(
      async () => svc.upload(traineeActor, { originalName: 'huge.pdf', contentType: 'application/pdf', data: largeBuffer, purpose: 'resume' }, reqInfo),
      (err: unknown) => err instanceof AppError && err.statusCode === 413,
    )
  })

  test('validates required originalName', async () => {
    const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db
    const svc = createFilesService(fakeDb)
    await assert.rejects(
      async () => svc.upload(traineeActor, { originalName: '   ', contentType: 'application/pdf', data: Buffer.from('abc'), purpose: 'resume' }, reqInfo),
      (err: unknown) => err instanceof AppError && err.statusCode === 422,
    )
  })
})

describe('Platform Services: Announcements', () => {
  test('non-superadmin cannot create national announcement', async () => {
    const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db
    const svc = createAnnouncementsService(fakeDb)
    await assert.rejects(
      async () => svc.create(traineeActor, { institutionId: null, audience: 'all', title: 'National Alert', body: 'Important announcement' }, reqInfo),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
    )
  })

  test('validates announcement title and body', async () => {
    const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db
    const svc = createAnnouncementsService(fakeDb)
    await assert.rejects(
      async () => svc.create(superAdmin, { audience: 'all', title: '  ', body: 'body' }, reqInfo),
      (err: unknown) => err instanceof AppError && err.statusCode === 422,
    )
  })
})

describe('Platform Services: Settings & Audit', () => {
  test('public settings endpoint returns only public values', async () => {
    const fakeDb = {
      query: async () => ({
        rows: [
          { key: 'app.name', value: 'NCCP Platform' },
          { key: 'theme.primary', value: '#10b981' },
        ],
      }),
    } as unknown as Db
    const svc = createSettingsService(fakeDb)
    const pub = await svc.getPublic()
    assert.deepEqual(pub, { 'app.name': 'NCCP Platform', 'theme.primary': '#10b981' })
  })

  test('non-superadmin cannot read or update system settings', async () => {
    const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db
    const svc = createSettingsService(fakeDb)
    await assert.rejects(
      async () => svc.listAll(traineeActor),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
    )
    await assert.rejects(
      async () => svc.update(traineeActor, 'app.name', 'Hacked', 1, reqInfo),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
    )
  })

  test('non-superadmin cannot query audit logs', async () => {
    const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db
    const svc = createAuditService(fakeDb)
    await assert.rejects(
      async () => svc.list(traineeActor, {}, { key: 'occurred_at', expr: 'a.occurred_at', type: 'timestamptz', dir: 'DESC' }, { limit: 25 }),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
    )
  })
})
