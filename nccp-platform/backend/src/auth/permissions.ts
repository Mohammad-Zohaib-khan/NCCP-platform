/**
 * Permission catalogue and role → permission map. This file is the source of truth; migration 0006 seeds the
 * same data into the DB (a unit test keeps the two in sync), and route guards use this in-memory map.
 * Format: '<resource>:<action>'. '*_own' means only records belonging to the caller; the service layer still
 * applies institution/employer/own-record scoping (see scope.ts) on top of the permission.
 */
export const ROLE_CODES = ['super_admin', 'institution_admin', 'trainer', 'trainee', 'employer'] as const
export type RoleCode = (typeof ROLE_CODES)[number]

export const PERMISSIONS = {
  // identity
  'users:read': 'View users in scope',
  'users:invite': 'Invite users in scope',
  'users:update': 'Edit users in scope',
  'users:disable': 'Disable / enable users in scope',
  'roles:read': 'View roles and permissions',
  'sessions:read_own': 'View own sessions',
  'sessions:revoke_own': 'Revoke own sessions',
  'sessions:revoke_any': 'Revoke any user session',
  // organisations
  'institutions:read': 'View institutions',
  'institutions:write': 'Create/edit institutions',
  'institutions:approve': 'Approve / reject / suspend institutions',
  'employers:read': 'View employers',
  'employers:write': 'Create/edit employers',
  'employers:verify': 'Verify / reject employers',
  // people
  'trainers:read': 'View trainers', 'trainers:write': 'Create/edit trainers',
  'trainees:read': 'View trainees', 'trainees:write': 'Create/edit trainees',
  'profile:read_own': 'View own profile', 'profile:write_own': 'Edit own profile',
  // training
  'programmes:read': 'View programmes', 'programmes:write': 'Create/edit programmes', 'programmes:approve': 'Approve programmes',
  'batches:read': 'View batches', 'batches:write': 'Create/edit batches',
  'enrolments:read': 'View enrolments', 'enrolments:write': 'Enrol / withdraw trainees',
  'enrolments:apply_own': 'Apply to a batch and withdraw own application',
  'courses:read': 'View courses', 'courses:write': 'Create/edit courses, modules, lessons',
  'lessons:progress_own': 'Record own lesson progress',
  'classes:read': 'View class sessions and timetable', 'classes:write': 'Schedule and edit class sessions',
  'attendance:read': 'View attendance', 'attendance:mark': 'Mark attendance', 'attendance:checkin_own': 'Self check-in',
  'assessments:read': 'View assessments', 'assessments:write': 'Create/grade assessments', 'assessments:attempt_own': 'Attempt assessments',
  // certification
  'certificates:read': 'View certificates', 'certificates:issue': 'Issue certificates', 'certificates:revoke': 'Revoke certificates',
  // employment
  'jobs:read': 'View jobs', 'jobs:write': 'Create/edit/publish jobs',
  'applications:read': 'View applications', 'applications:write': 'Move applications through stages',
  'applications:apply_own': 'Apply for jobs and withdraw own applications',
  'candidates:search': 'Search trainee talent pool',
  'interviews:write': 'Schedule interviews', 'placements:write': 'Record placements', 'placements:read': 'View placements in scope',
  // platform
  'notifications:read_own': 'View own notifications',
  'announcements:read': 'View announcements', 'announcements:write': 'Publish announcements',
  'files:upload': 'Upload files', 'files:read': 'Download authorised files',
  'audit:read': 'View audit log',
  'settings:read': 'View system settings', 'settings:write': 'Change system settings',
  'analytics:read': 'View dashboards and reports',
} as const
export type Permission = keyof typeof PERMISSIONS

const own: Permission[] = ['sessions:read_own', 'sessions:revoke_own', 'profile:read_own', 'profile:write_own', 'notifications:read_own']

export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  super_admin: Object.keys(PERMISSIONS) as Permission[],
  institution_admin: [
    ...own, 'users:read', 'users:invite', 'users:update', 'users:disable', 'roles:read',
    'institutions:read', 'institutions:write', 'employers:read',
    'trainers:read', 'trainers:write', 'trainees:read', 'trainees:write',
    'programmes:read', 'programmes:write', 'batches:read', 'batches:write',
    'enrolments:read', 'enrolments:write', 'courses:read', 'courses:write', 'classes:read', 'classes:write',
    'attendance:read', 'assessments:read', 'assessments:write', 'placements:read',
    'certificates:read', 'certificates:issue', 'announcements:read', 'announcements:write',
    'files:upload', 'files:read', 'analytics:read',
  ],
  trainer: [
    ...own, 'institutions:read', 'trainees:read', 'programmes:read', 'batches:read', 'enrolments:read',
    'courses:read', 'courses:write', 'classes:read', 'classes:write', 'attendance:read', 'attendance:mark',
    'assessments:read', 'assessments:write', 'certificates:read', 'announcements:read',
    'files:upload', 'files:read', 'analytics:read',
  ],
  trainee: [
    ...own, 'programmes:read', 'batches:read', 'enrolments:read', 'enrolments:apply_own', 'courses:read', 'lessons:progress_own', 'classes:read',
    'attendance:read', 'attendance:checkin_own', 'assessments:read', 'assessments:attempt_own',
    'certificates:read', 'jobs:read', 'applications:read', 'applications:apply_own', 'placements:read',
    'announcements:read', 'files:upload', 'files:read',
  ],
  employer: [
    ...own, 'employers:read', 'employers:write', 'jobs:read', 'jobs:write',
    'applications:read', 'applications:write', 'candidates:search', 'interviews:write', 'placements:write', 'placements:read',
    'certificates:read', 'announcements:read', 'files:upload', 'files:read', 'analytics:read', 'users:read',
  ],
}

export const isRoleCode = (v: string): v is RoleCode => (ROLE_CODES as readonly string[]).includes(v)
export function can(role: string, permission: Permission): boolean {
  return isRoleCode(role) && ROLE_PERMISSIONS[role].includes(permission)
}

/** Roles that must use MFA (spec §4: privileged accounts). Enforced at login once MFA is enrolled, and enrolment is forced. */
export const MFA_REQUIRED_ROLES: readonly RoleCode[] = ['super_admin']
/** Which roles an inviter may create. Institution admins cannot mint admins or employers. */
export const INVITABLE_BY: Record<RoleCode, readonly RoleCode[]> = {
  super_admin: ['super_admin', 'institution_admin', 'trainer', 'trainee', 'employer'],
  institution_admin: ['trainer', 'trainee'],
  trainer: [], trainee: [],
  employer: [],
}
