-- 0010: Part 6 employment - placements:read permission, append-only application history, supporting indexes.
-- Additive only. src/auth/permissions.ts is the source of truth and a test keeps 0006 + 0007 + 0010 equal to it.
INSERT INTO permissions (code, description) VALUES
  ('placements:read', 'View placements in scope')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('super_admin', 'placements:read'),
  ('institution_admin', 'placements:read'),
  ('employer', 'placements:read'),
  ('trainee', 'placements:read')
ON CONFLICT DO NOTHING;

-- Application stage history is append-only: rows can be added, never edited. (Deleting stays possible so ON DELETE CASCADE from
-- a hard-deleted job or application still works; the services never delete history.)
CREATE OR REPLACE FUNCTION application_history_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'application_status_history is append-only (UPDATE not permitted)' USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER application_status_history_no_update BEFORE UPDATE ON application_status_history FOR EACH ROW EXECUTE FUNCTION application_history_no_update();

-- Discovery and the "already applied" check hit these constantly.
CREATE INDEX IF NOT EXISTS employers_status_idx ON employers (verification_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS placements_job_idx ON placements (job_id, status);
