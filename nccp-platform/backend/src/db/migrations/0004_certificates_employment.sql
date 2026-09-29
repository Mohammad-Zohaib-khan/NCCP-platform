-- 0004: certificates and the employment lifecycle

CREATE TABLE certificates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_no    text NOT NULL UNIQUE,                   -- human-readable, printed on the document
  verification_code text NOT NULL UNIQUE,                   -- random public code used by /certificates/verify
  trainee_id        uuid NOT NULL REFERENCES trainees(id) ON DELETE RESTRICT,
  enrolment_id      uuid NOT NULL REFERENCES batch_enrolments(id) ON DELETE RESTRICT,
  programme_id      uuid NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  institution_id    uuid REFERENCES institutions(id) ON DELETE SET NULL,
  title             text NOT NULL,
  grade             text,
  score             numeric(5,2),
  status            text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','revoked')),
  issued_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  revoked_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at        timestamptz,
  revocation_reason text,
  file_id           uuid,                                   -- rendered PDF (FK in 0005)
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- a trainee can hold only one live certificate per enrolment
  CONSTRAINT certificate_revocation_consistent CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL) OR
    (status = 'issued'  AND revoked_at IS NULL)
  )
);
CREATE UNIQUE INDEX certificates_one_live_per_enrolment ON certificates (enrolment_id) WHERE status = 'issued';
CREATE INDEX certificates_trainee_idx ON certificates (trainee_id);
CREATE TRIGGER certificates_touch BEFORE UPDATE ON certificates FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id     uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  title           text NOT NULL,
  employment_type text NOT NULL DEFAULT 'Full time',        -- UI labels: Full time / Contract / ...
  openings        integer NOT NULL DEFAULT 1 CHECK (openings > 0),
  location        text,
  work_mode       text,                                     -- On-site / Field / Hybrid / Remote
  experience      text,
  salary_text     text,                                     -- displayed as entered, e.g. '₹3.2–4.2 LPA'
  salary_min      numeric(12,2),
  salary_max      numeric(12,2),
  description     text,
  required_skills text,
  preferred_skills text,
  qualification   text,
  benefits        text,
  deadline        date,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','closed')),
  published_at    timestamptz,
  closed_at       timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CHECK (salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min)
);
CREATE INDEX jobs_employer_idx ON jobs (employer_id, status) WHERE deleted_at IS NULL;
CREATE INDEX jobs_open_idx     ON jobs (published_at DESC) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX jobs_title_trgm   ON jobs USING gin (title gin_trgm_ops);
CREATE TRIGGER jobs_touch BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE applications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  trainee_id     uuid NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'review'
                   CHECK (status IN ('review','shortlisted','interview','offer','placed','rejected','withdrawn')),
  match_score    numeric(5,2) CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 100),
  cover_note     text,
  resume_file_id uuid,                                      -- FK in 0005
  employer_notes text,
  decided_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  version        integer NOT NULL DEFAULT 1,
  applied_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, trainee_id)
);
CREATE INDEX applications_job_idx     ON applications (job_id, status);
CREATE INDEX applications_trainee_idx ON applications (trainee_id, applied_at DESC);
CREATE TRIGGER applications_touch BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION touch_row();

-- Append-only stage history (who moved an applicant, when, why).
CREATE TABLE application_status_history (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status    text,
  to_status      text NOT NULL,
  changed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  note           text,
  changed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_history_app_idx ON application_status_history (application_id, changed_at);

CREATE TABLE interviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  scheduled_at   timestamptz NOT NULL,
  mode           text NOT NULL DEFAULT 'video' CHECK (mode IN ('video','phone','in_person')),
  location_or_link text,
  notes          text,
  status         text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','completed','cancelled','no_show')),
  outcome_notes  text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interviews_app_idx  ON interviews (application_id);
CREATE INDEX interviews_when_idx ON interviews (scheduled_at) WHERE status IN ('scheduled','confirmed');
CREATE TRIGGER interviews_touch BEFORE UPDATE ON interviews FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE placements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES applications(id) ON DELETE RESTRICT,
  employer_id    uuid NOT NULL REFERENCES employers(id) ON DELETE RESTRICT,
  trainee_id     uuid NOT NULL REFERENCES trainees(id) ON DELETE RESTRICT,
  job_id         uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  joining_date   date,
  salary_offered numeric(12,2),
  status         text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','joined','not_joined','left')),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX placements_employer_idx ON placements (employer_id);
CREATE INDEX placements_trainee_idx  ON placements (trainee_id);
CREATE TRIGGER placements_touch BEFORE UPDATE ON placements FOR EACH ROW EXECUTE FUNCTION touch_row();
