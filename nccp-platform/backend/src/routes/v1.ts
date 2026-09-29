import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../config/env.js'
import type { Db } from '../db/pool.js'
import type { Mailer } from '../lib/mailer.js'
import { createAuthService } from '../modules/auth/service.js'
import { createUsersService } from '../modules/auth/users.service.js'
import { authRoutes } from '../modules/auth/routes.js'
import { createInstitutionsService } from '../modules/institutions/service.js'
import { institutionRoutes } from '../modules/institutions/routes.js'
import { createTrainersService } from '../modules/people/trainers.service.js'
import { createTraineesService } from '../modules/people/trainees.service.js'
import { peopleRoutes } from '../modules/people/routes.js'
import { createProgrammesService } from '../modules/training/programmes.service.js'
import { createBatchesService } from '../modules/training/batches.service.js'
import { trainingRoutes } from '../modules/training/routes.js'
import { createEnrolmentsService } from '../modules/learning/enrolments.service.js'
import { createLmsService } from '../modules/learning/lms.service.js'
import { createSessionsService } from '../modules/learning/sessions.service.js'
import { createAttendanceService } from '../modules/learning/attendance.service.js'
import { createAssessmentsService } from '../modules/learning/assessments.service.js'
import { learningRoutes } from '../modules/learning/routes.js'
import { i18nRoutes } from '../modules/i18n/routes.js'
import { createCertificatesService } from '../modules/certificates/certificates.service.js'
import { certificateRoutes } from '../modules/certificates/certificates.routes.js'
import { createEmployersService } from '../modules/employment/employers.service.js'
import { createJobsService } from '../modules/employment/jobs.service.js'
import { createApplicationsService } from '../modules/employment/applications.service.js'
import { createInterviewsService } from '../modules/employment/interviews.service.js'
import { createPlacementsService } from '../modules/employment/placements.service.js'
import { createCandidatesService } from '../modules/employment/candidates.service.js'
import { employmentRoutes } from '../modules/employment/employment.routes.js'
import { createFilesService } from '../modules/platform/files.service.js'
import { createAnnouncementsService } from '../modules/platform/announcements.service.js'
import { createNotificationsService } from '../modules/platform/notifications.service.js'
import { createSettingsService } from '../modules/platform/settings.service.js'
import { createAuditService } from '../modules/platform/audit.service.js'
import { platformRoutes } from '../modules/platform/platform.routes.js'
import { createWorkspaceService } from '../modules/platform/workspace.service.js'
import { workspaceRoutes } from '../modules/platform/workspace.routes.js'
import { createAnalyticsService } from '../modules/analytics/analytics.service.js'
import { analyticsRoutes } from '../modules/analytics/analytics.routes.js'

export interface V1Deps { config: AppConfig; db: Db; mailer: Mailer }

/**
 * Root of the versioned API (/api/v1). Domain modules are registered here as they ship, so every module
 * inherits the same prefix, hooks and error handling.
 */
export async function v1Routes(app: FastifyInstance, deps: V1Deps): Promise<void> {
  const authDeps = { db: deps.db, config: deps.config, mailer: deps.mailer }
  const auth = createAuthService(authDeps)
  const users = createUsersService(authDeps, auth)

  app.get('/', async () => ({
    name: 'NCCP API',
    version: 'v1',
    modules: [
      'auth', 'users', 'roles', 'institutions', 'trainers', 'trainees', 'programmes', 'batches',
      'enrolments', 'courses', 'modules', 'lessons', 'resources', 'sessions', 'timetable',
      'attendance', 'assessments', 'i18n', 'certificates', 'verify',
      'employers', 'jobs', 'applications', 'interviews', 'placements', 'candidates',
      'files', 'announcements', 'notifications', 'settings', 'audit',
      'analytics',
    ],
  }))
  await app.register(authRoutes, { config: deps.config, auth, users })
  await app.register(institutionRoutes, { config: deps.config, service: createInstitutionsService(deps.db) })
  await app.register(peopleRoutes, { config: deps.config, trainers: createTrainersService(deps.db, auth), trainees: createTraineesService(deps.db, auth) })
  await app.register(trainingRoutes, { config: deps.config, programmes: createProgrammesService(deps.db), batches: createBatchesService(deps.db) })
  await app.register(i18nRoutes, { db: deps.db, config: deps.config })
  await app.register(learningRoutes, {
    db: deps.db, config: deps.config, enrolments: createEnrolmentsService(deps.db), lms: createLmsService(deps.db, deps.config.i18n), sessions: createSessionsService(deps.db),
    attendance: createAttendanceService(deps.db, { config: deps.config }), assessments: createAssessmentsService(deps.db),
  })
  await app.register(certificateRoutes, { config: deps.config, service: createCertificatesService(deps.db, { appBaseUrl: deps.config.appBaseUrl }) })
  await app.register(employmentRoutes, {
    config: deps.config,
    employers: createEmployersService(deps.db),
    jobs: createJobsService(deps.db),
    applications: createApplicationsService(deps.db),
    interviews: createInterviewsService(deps.db),
    placements: createPlacementsService(deps.db),
    candidates: createCandidatesService(deps.db),
  })
  await app.register(platformRoutes, {
    config: deps.config,
    files: createFilesService(deps.db),
    announcements: createAnnouncementsService(deps.db),
    notifications: createNotificationsService(deps.db),
    settings: createSettingsService(deps.db),
    audit: createAuditService(deps.db),
  })
  await app.register(analyticsRoutes, {
    config: deps.config,
    service: createAnalyticsService(deps.db),
  })
  await app.register(workspaceRoutes, {
    config: deps.config,
    service: createWorkspaceService(deps.db),
  })
}
