-- 0002: institutions, employers, and the people who belong to them

CREATE TABLE institutions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text UNIQUE,                             -- short human code, e.g. 'RCI-JP'
  name             text NOT NULL,
  institution_type text,
  state            text,
  district         text,
  address          text,
  pincode          text,
  contact_name     text,
  contact_email    citext,
  contact_phone    text,
  website          text,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','active','suspended','rejected')),
  approved_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  rejection_reason text,
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX institutions_status_idx ON institutions (status) WHERE deleted_at IS NULL;
CREATE INDEX institutions_state_idx  ON institutions (state)  WHERE deleted_at IS NULL;
CREATE INDEX institutions_name_trgm  ON institutions USING gin (name gin_trgm_ops);
CREATE TRIGGER institutions_touch BEFORE UPDATE ON institutions FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE institution_users (
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_role       text NOT NULL DEFAULT 'member' CHECK (org_role IN ('owner','admin','member')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, user_id)
);
CREATE INDEX institution_users_user_idx ON institution_users (user_id);

CREATE TABLE employers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  sector             text,
  location           text,
  website            text,
  about              text,
  registration_no    text,
  contact_name       text,
  contact_email      citext,
  contact_phone      text,
  verification_status text NOT NULL DEFAULT 'unverified'
                       CHECK (verification_status IN ('unverified','pending','verified','rejected','suspended')),
  verified_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at        timestamptz,
  rejection_reason   text,
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX employers_verification_idx ON employers (verification_status) WHERE deleted_at IS NULL;
CREATE INDEX employers_name_trgm ON employers USING gin (name gin_trgm_ops);
CREATE TRIGGER employers_touch BEFORE UPDATE ON employers FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE employer_users (
  employer_id uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_role    text NOT NULL DEFAULT 'recruiter' CHECK (org_role IN ('owner','admin','recruiter','viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employer_id, user_id)
);
CREATE INDEX employer_users_user_idx ON employer_users (user_id);

CREATE TABLE trainers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  institution_id  uuid NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  designation     text,
  qualifications  text,
  expertise       text[] NOT NULL DEFAULT '{}',
  experience_years integer CHECK (experience_years IS NULL OR experience_years >= 0),
  availability    jsonb NOT NULL DEFAULT '{}'::jsonb,       -- weekly slots
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','on_leave')),
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX trainers_institution_idx ON trainers (institution_id) WHERE deleted_at IS NULL;
CREATE INDEX trainers_expertise_gin   ON trainers USING gin (expertise);
CREATE TRIGGER trainers_touch BEFORE UPDATE ON trainers FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE trainees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  institution_id  uuid REFERENCES institutions(id) ON DELETE SET NULL,
  gender          text CHECK (gender IN ('female','male','other','undisclosed')),
  date_of_birth   date,
  state           text,
  district        text,
  location        text,
  education       text,
  skills          text[] NOT NULL DEFAULT '{}',
  career_profile  jsonb NOT NULL DEFAULT '{}'::jsonb,       -- headline, availability, preferences
  open_to_work    boolean NOT NULL DEFAULT true,            -- visible to employer candidate search
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','graduated','dropped')),
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX trainees_institution_idx ON trainees (institution_id) WHERE deleted_at IS NULL;
CREATE INDEX trainees_state_idx       ON trainees (state) WHERE deleted_at IS NULL;
CREATE INDEX trainees_skills_gin      ON trainees USING gin (skills);
CREATE TRIGGER trainees_touch BEFORE UPDATE ON trainees FOR EACH ROW EXECUTE FUNCTION touch_row();
