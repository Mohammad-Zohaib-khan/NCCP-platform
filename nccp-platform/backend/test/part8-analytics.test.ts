import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Db } from '../src/db/pool.js'
import type { AuthContext } from '../src/auth/context.js'
import { createAnalyticsService } from '../src/modules/analytics/analytics.service.js'

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

describe('Analytics Services: Multi-tenant Dashboards', () => {
  test('national dashboard returns structured aggregates for all domains', async () => {
    const fakeDb = {
      query: async (sql: string) => {
        if (sql.includes('institutions')) {
          return { rows: [{ total: 10, active: 8, pending: 2 }] }
        }
        if (sql.includes('programmes')) {
          return { rows: [{ programmes: 5, batches: 12, active_batches: 6, trainees: 150, trainers: 20, enrolments: 140 }] }
        }
        if (sql.includes('certificates')) {
          return { rows: [{ issued: 85, revoked: 2 }] }
        }
        if (sql.includes('employers')) {
          return { rows: [{ employers: 25, verified_employers: 18, active_jobs: 30, applications: 220, placements: 45 }] }
        }
        if (sql.includes('attendance_records')) {
          return { rows: [{ total: 500, attended: 450, manual: 100, qr: 300, fingerprint: 50, face: 0 }] }
        }
        return { rows: [] }
      },
    } as unknown as Db

    const svc = createAnalyticsService(fakeDb)
    const data = await svc.getNationalDashboard()

    assert.equal(data.scope, 'national')
    assert.equal(data.institutions.total, 10)
    assert.equal(data.institutions.active, 8)
    assert.equal(data.training.programmes, 5)
    assert.equal(data.training.trainees, 150)
    assert.equal(data.certificates.issued, 85)
    assert.equal(data.employment.placements, 45)
    assert.equal(data.attendance.totalMarked, 500)
    assert.equal(data.attendance.attendanceRatePercent, 90)
    assert.equal(data.attendance.breakdown.qr, 300)
  })

  test('employer dashboard returns job pipeline and average match score', async () => {
    const fakeDb = {
      query: async () => ({
        rows: [{
          jobs_total: 6,
          jobs_active: 4,
          apps_total: 28,
          apps_review: 10,
          apps_shortlisted: 8,
          apps_interview: 5,
          apps_offer: 3,
          apps_placed: 2,
          placements: 2,
          avg_match: 78.456,
        }],
      }),
    } as unknown as Db

    const svc = createAnalyticsService(fakeDb)
    const data = await svc.getEmployerDashboard(employerActor.employerIds)

    assert.equal(data.scope, 'employer')
    assert.equal(data.jobs.active, 4)
    assert.equal(data.applications.total, 28)
    assert.equal(data.applications.placed, 2)
    assert.equal(data.averageMatchScore, 78.46)
  })

  test('getDashboard dispatches correctly based on actor role', async () => {
    let calledScope = ''
    const fakeDb = {
      query: async (sql: string) => {
        if (sql.includes('institutions')) {
          calledScope = 'national'
          return { rows: [{ total: 1, active: 1, pending: 0 }] }
        }
        return { rows: [{}] }
      },
    } as unknown as Db

    const svc = createAnalyticsService(fakeDb)
    const res = await svc.getDashboard(superAdmin)
    assert.equal(res.scope, 'national')
    assert.equal(calledScope, 'national')
  })
})
