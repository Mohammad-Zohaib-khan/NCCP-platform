-- 0001: extensions, shared helpers, identity, RBAC, sessions
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Shared trigger: keep updated_at fresh and bump optimistic-concurrency version.
CREATE OR REPLACE FUNCTION touch_row() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ---------- roles & permissions ----------
CREATE TABLE roles (
  code         text PRIMARY KEY,
  name         text NOT NULL,
  description  text,
  -- the workspace this role lands in on the frontend
  workspace    text NOT NULL CHECK (workspace IN ('admin','institution','trainer','trainee','employer')),
  is_system    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  code         text PRIMARY KEY,              -- e.g. 'institutions:read'
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_code        text NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code  text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

INSERT INTO roles (code, name, description, workspace) VALUES
  ('super_admin',       'NCCT Super Admin',          'National-level administration of the whole platform', 'admin'),
  ('institution_admin', 'Institution Administrator', 'Manages one institution and its trainers/trainees',   'institution'),
  ('trainer',           'Trainer',                   'Delivers batches, marks attendance, assesses',         'trainer'),
  ('trainee',           'Trainee / Rural Youth',     'Learns, attends, applies for jobs',                    'trainee'),
  ('employer',          'Employer / Recruiter',      'Posts jobs and manages applicants',                    'employer');

-- ---------- users ----------
CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                citext NOT NULL UNIQUE,
  full_name            text NOT NULL,
  phone                text,
  password_hash        text,                               -- argon2id/bcrypt; NULL until invitation accepted
  role_code            text NOT NULL REFERENCES roles(code),
  status               text NOT NULL DEFAULT 'invited'
                         CHECK (status IN ('invited','pending_verification','active','locked','disabled')),
  email_verified_at    timestamptz,
  last_login_at        timestamptz,
  failed_login_count   integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until         timestamptz,
  password_changed_at  timestamptz,
  mfa_enabled          boolean NOT NULL DEFAULT false,
  mfa_secret_enc       text,                               -- encrypted TOTP secret (Part 2)
  avatar_file_id       uuid,                               -- FK added in 0005 once files exists
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);
CREATE INDEX users_role_idx   ON users (role_code) WHERE deleted_at IS NULL;
CREATE INDEX users_status_idx ON users (status)    WHERE deleted_at IS NULL;
CREATE INDEX users_name_trgm  ON users USING gin (full_name gin_trgm_ops);
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------- sessions (refresh-token rotation) ----------
CREATE TABLE user_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id          uuid NOT NULL,                        -- rotation family; reuse of an old token revokes the family
  refresh_token_hash text NOT NULL UNIQUE,                 -- SHA-256 of the opaque token; token itself never stored
  user_agent         text,
  ip_address         inet,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_reason     text,
  replaced_by        uuid REFERENCES user_sessions(id)
);
CREATE INDEX user_sessions_user_idx   ON user_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX user_sessions_family_idx ON user_sessions (family_id);
CREATE INDEX user_sessions_expiry_idx ON user_sessions (expires_at);

-- ---------- one-time tokens: invitations, email verification, password reset ----------
CREATE TABLE user_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('invitation','email_verification','password_reset','mfa_recovery')),
  token_hash  text NOT NULL UNIQUE,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX user_tokens_user_idx ON user_tokens (user_id, purpose) WHERE used_at IS NULL;

CREATE TABLE mfa_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_recovery_user_idx ON mfa_recovery_codes (user_id) WHERE used_at IS NULL;
