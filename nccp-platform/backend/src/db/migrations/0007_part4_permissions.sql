-- 0007: Part 4 permissions (additive; src/auth/permissions.ts is the source of truth and a test keeps 0006+0007 equal to it)
INSERT INTO permissions (code, description) VALUES
  ('enrolments:apply_own', 'Apply to a batch and withdraw own application'),
  ('lessons:progress_own', 'Record own lesson progress'),
  ('classes:read', 'View class sessions and timetable'),
  ('classes:write', 'Schedule and edit class sessions')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('super_admin', 'enrolments:apply_own'),
  ('super_admin', 'lessons:progress_own'),
  ('super_admin', 'classes:read'),
  ('super_admin', 'classes:write'),
  ('institution_admin', 'classes:read'),
  ('institution_admin', 'classes:write'),
  ('trainer', 'classes:read'),
  ('trainer', 'classes:write'),
  ('trainee', 'enrolments:apply_own'),
  ('trainee', 'lessons:progress_own'),
  ('trainee', 'classes:read')
ON CONFLICT DO NOTHING;
