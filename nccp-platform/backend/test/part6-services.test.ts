import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Db } from '../src/db/pool.js'
import type { AuthContext } from '../src/auth/context.js'
import { AppError } from '../src/lib/errors.js'
import { createEmployersService } from '../src/modules/employment/employers.service.js'
import { createJobsService } from '../src/modules/employment/jobs.service.js'
import { createApplicationsService } from '../src/modules/employment/applications.service.js'
import { createInterviewsService } from '../src/modules/employment/interviews.service.js'
import { createPlacementsService } from '../src/modules/employment/placements.service.js'
import { createCandidatesService } from '../src/modules/employment/candidates.service.js'

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

const employerActor: AuthContext = {
  userId: '00000000-0000-4000-8000-000000000002',
  role: 'employer',
  sessionId: 'sess-2',
  fullName: 'Employer User',
  email: 'hr@acme.com',
  institutionIds: [],
  employerIds: ['11111111-1111-4111-8111-111111111111'],
  mfaEnabled: false,
  mfaSetupRequired: false,
}

const traineeActor: AuthContext = {
  userId: '00000000-0000-4000-8000-000000000003',
  role: 'trainee',
  sessionId: 'sess-3',
  fullName: 'Trainee User',
  email: 'trainee@gmail.com',
  institutionIds: [],
  employerIds: [],
  mfaEnabled: false,
  mfaSetupRequired: false,
}

const reqInfo = { ip: '127.0.0.1', userAgent: 'test-agent', requestId: 'test-req-1' }

describe('Employment Services: Employers', () => {
  test('public apply validates name and contact', async () => {
    const fakeDb = {
      connect: async () => ({
        query: async () => ({ rows: [{ id: '11111111-1111-4111-8111-111111111111' }] }),
        release: () => {},
      }),
      query: async () => ({ rows: [] }),
    } as unknown as Db

    const svc = createEmployersService(fakeDb)
    await assert.rejects(
      async () => svc.applyPublic({ name: '' }, reqInfo),
      (err: unknown) => err instanceof AppError && err.statusCode === 422,
    )
  })

  test('non-superadmin cannot directly create employer', async () => {
    const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db
    const svc = createEmployersService(fakeDb)
    await assert.rejects(
      async () => svc.create(employerActor, { name: 'Acme Corp' }, reqInfo),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
    )
  })
})

describe('Employment Services: Jobs', () => {
  test('creating job validates salary range and employer access', async () => {
    const fakeDb = {
      query: async () => ({ rows: [] }),
    } as unknown as Db
    const svc = createJobsService(fakeDb)

    // Foreign employer ID throws 404/403
    await assert.rejects(
      async () => svc.create(employerActor, { employerId: '22222222-2222-4222-8222-222222222222', title: 'Developer' }, reqInfo),
      (err: unknown) => err instanceof AppError && (err.statusCode === 404 || err.statusCode === 403),
    )

    // Salary max < salary min throws 422
    await assert.rejects(
      async () => svc.create(employerActor, { employerId: '11111111-1111-4111-8111-111111111111', title: 'Developer', salaryMin: 50000, salaryMax: 40000 }, reqInfo),
      (err: unknown) => err instanceof AppError && err.statusCode === 422,
    )
  })
})

describe('Employment Services: Applications & Match Score', () => {
  test('non-trainee cannot apply for jobs', async () => {
    const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db
    const svc = createApplicationsService(fakeDb)
    await assert.rejects(
      async () => svc.apply(employerActor, { jobId: '33333333-3333-4333-8333-333333333333' }, reqInfo),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
    )
  })
})

describe('Employment Services: Interviews & Placements', () => {
  test('only employer can schedule interviews', async () => {
    const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db
    const svc = createInterviewsService(fakeDb)
    await assert.rejects(
      async () => svc.schedule(traineeActor, { applicationId: '44444444-4444-4444-8444-444444444444', scheduledAt: new Date(Date.now() + 86400000), mode: 'video', locationOrLink: 'https://meet.google.com/abc' }, reqInfo),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
    )
  })

  test('only employer or admin can record placements', async () => {
    const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db
    const svc = createPlacementsService(fakeDb)
    await assert.rejects(
      async () => svc.record(traineeActor, { applicationId: '55555555-5555-4555-8555-555555555555' }, reqInfo),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
    )
  })

  test('only employer or admin can search candidates', async () => {
    const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db
    const svc = createCandidatesService(fakeDb)
    await assert.rejects(
      async () => svc.search(traineeActor, {}, { key: 'trainee_id', expr: 't.id', type: 'text', dir: 'ASC' }, { limit: 10 }),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
    )
  })
})
