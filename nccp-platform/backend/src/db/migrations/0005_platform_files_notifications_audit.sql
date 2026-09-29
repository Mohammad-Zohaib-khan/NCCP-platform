-- 0005: files, notices, notifications, audit, settings, idempotency, analytics + deferred FKs

CREATE TABLE files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key    text NOT NULL UNIQUE,                    -- object-storage key (never a public URL)
  original_name  text NOT NULL,
  content_type   text NOT NULL,
  size_bytes     bigint NOT NULL CHECK (size_bytes >= 0),
  sha256         text,
  purpose        text NOT NULL CHECK (purpose IN (
                   'avatar','resume','course_resource','certificate','employer_document','institution_document','other')),
  owner_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  institution_id uuid REFERENCES institutions(id) ON DELETE SET NULL,   -- scoping for authorization
  employer_id    uuid REFERENCES employers(id) ON DELETE SET NULL,
  visibility     text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','org','authenticated')),
  scan_status    text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected','skipped')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX files_owner_idx       ON files (owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX files_institution_idx ON files (institution_id) WHERE deleted_at IS NULL;
CREATE INDEX files_employer_idx    ON files (employer_id) WHERE deleted_at IS NULL;

-- Deferred foreign keys to files
ALTER TABLE users        ADD CONSTRAINT users_avatar_file_fk        FOREIGN KEY (avatar_file_id)  REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE resources    ADD CONSTRAINT resources_file_fk           FOREIGN KEY (file_id)         REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE certificates ADD CONSTRAINT certificates_file_fk        FOREIGN KEY (file_id)         REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE applications ADD CONSTRAINT applications_resume_file_fk FOREIGN KEY (resume_file_id)  REFERENCES files(id) ON DELETE SET NULL;

-- Institution/NCCP notices & announcements (UI: "Create Announcement", "notices")
CREATE TABLE announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid REFERENCES institutions(id) ON DELETE CASCADE,   -- NULL = national
  batch_id        uuid REFERENCES batches(id) ON DELETE CASCADE,
  audience        text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','trainers','trainees','institution_admins','employers')),
  title           text NOT NULL,
  body            text NOT NULL,
  published_at    timestamptz,
  expires_at      timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX announcements_scope_idx ON announcements (institution_id, published_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER announcements_touch BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------- notifications: event -> record -> delivery(ies) ----------
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         text NOT NULL,                              -- e.g. 'application.status_changed'
  title        text NOT NULL,
  body         text,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,         -- deep-link payload (ids only, no secrets)
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_user_idx        ON notifications (user_id, created_at DESC);

CREATE TABLE notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('in_app','email','sms')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  provider_ref    text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, channel)
);
-- worker picks work from here
CREATE INDEX notification_deliveries_due_idx ON notification_deliveries (next_attempt_at) WHERE status = 'pending';

-- ---------- audit log (append-only) ----------
CREATE TABLE audit_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,                                      -- no FK: log must outlive user deletion
  actor_role    text,
  action        text NOT NULL,                             -- e.g. 'auth.login', 'institution.approve'
  entity_type   text,
  entity_id     text,
  institution_id uuid,
  employer_id    uuid,
  outcome       text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','failure','denied')),
  request_id    text,
  ip_address    inet,
  user_agent    text,
  changes       jsonb                                      -- before/after diff with secrets stripped
);
CREATE INDEX audit_logs_time_idx   ON audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_actor_idx  ON audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, occurred_at DESC);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% not permitted)', TG_OP USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- ---------- system settings (+ audited history) ----------
CREATE TABLE system_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  is_public   boolean NOT NULL DEFAULT false,              -- safe to expose to unauthenticated frontend
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1
);
CREATE TRIGGER system_settings_touch BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE system_settings_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         text NOT NULL,
  old_value   jsonb,
  new_value   jsonb,
  changed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_settings_history_key_idx ON system_settings_history (key, changed_at DESC);

CREATE OR REPLACE FUNCTION log_setting_change() RETURNS trigger AS $$
BEGIN
  INSERT INTO system_settings_history (key, old_value, new_value, changed_by)
  VALUES (NEW.key, CASE WHEN TG_OP = 'UPDATE' THEN OLD.value END, NEW.value, NEW.updated_by);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER system_settings_history_trg AFTER INSERT OR UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION log_setting_change();

-- ---------- idempotency for important writes ----------
CREATE TABLE idempotency_keys (
  key            text NOT NULL,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_hash   text NOT NULL,                            -- same key + different body => 409
  method         text NOT NULL,
  path           text NOT NULL,
  response_status integer,
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

-- ---------- analytics snapshots (optional precomputed dashboard metrics) ----------
CREATE TABLE analytics_snapshots (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope          text NOT NULL CHECK (scope IN ('national','institution','employer','trainer','programme')),
  scope_id       uuid,
  metric         text NOT NULL,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  value          numeric NOT NULL,
  dimensions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX analytics_snapshots_unique_idx
  ON analytics_snapshots (scope, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), metric, period_start, period_end, (dimensions::text));
CREATE INDEX analytics_snapshots_lookup_idx ON analytics_snapshots (scope, scope_id, metric, period_end DESC);
