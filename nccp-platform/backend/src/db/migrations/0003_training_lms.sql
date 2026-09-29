-- 0003: programmes, batches, enrolments, sessions, LMS, attendance, assessments

CREATE TABLE programmes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text UNIQUE,
  title             text NOT NULL,
  description       text,
  category          text,
  duration_weeks    integer CHECK (duration_weeks IS NULL OR duration_weeks > 0),
  eligibility       text,
  institution_id    uuid REFERENCES institutions(id) ON DELETE SET NULL,   -- NULL = national programme owned by NCCT
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','active','archived','rejected')),
  approved_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  version           integer NOT NULL DEFAULT 1,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX programmes_institution_idx ON programmes (institution_id) WHERE deleted_at IS NULL;
CREATE INDEX programmes_status_idx      ON programmes (status) WHERE deleted_at IS NULL;
CREATE INDEX programmes_title_trgm      ON programmes USING gin (title gin_trgm_ops);
CREATE TRIGGER programmes_touch BEFORE UPDATE ON programmes FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL,                              -- e.g. 'DC-01'
  programme_id    uuid NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  institution_id  uuid NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  trainer_id      uuid REFERENCES trainers(id) ON DELETE SET NULL,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  capacity        integer NOT NULL CHECK (capacity > 0),
  schedule        text,                                       -- e.g. 'Mon, Wed, Fri'
  mode            text NOT NULL DEFAULT 'offline' CHECK (mode IN ('offline','online','hybrid')),
  status          text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ongoing','completed','cancelled')),
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CHECK (end_date >= start_date),
  UNIQUE (institution_id, code)
);
CREATE INDEX batches_programme_idx ON batches (programme_id) WHERE deleted_at IS NULL;
CREATE INDEX batches_trainer_idx   ON batches (trainer_id)   WHERE deleted_at IS NULL;
CREATE INDEX batches_status_idx    ON batches (status, start_date) WHERE deleted_at IS NULL;
CREATE TRIGGER batches_touch BEFORE UPDATE ON batches FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE batch_enrolments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  trainee_id       uuid NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'enrolled'
                     CHECK (status IN ('applied','enrolled','in_progress','completed','dropped','rejected')),
  progress_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  enrolled_at      timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  final_score      numeric(5,2) CHECK (final_score IS NULL OR final_score BETWEEN 0 AND 100),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, trainee_id)
);
CREATE INDEX batch_enrolments_trainee_idx ON batch_enrolments (trainee_id);
CREATE INDEX batch_enrolments_status_idx  ON batch_enrolments (batch_id, status);
CREATE TRIGGER batch_enrolments_touch BEFORE UPDATE ON batch_enrolments FOR EACH ROW EXECUTE FUNCTION touch_row();

-- Individual class sessions (live/offline). Attendance hangs off these.
CREATE TABLE class_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id     uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  title        text NOT NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  mode         text NOT NULL DEFAULT 'offline' CHECK (mode IN ('offline','online')),
  join_url     text,
  location     text,
  status       text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','completed','cancelled')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX class_sessions_batch_idx ON class_sessions (batch_id, starts_at);
CREATE TRIGGER class_sessions_touch BEFORE UPDATE ON class_sessions FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE attendance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  trainee_id     uuid NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  status         text NOT NULL CHECK (status IN ('present','late','absent','excused')),
  method         text NOT NULL DEFAULT 'manual' CHECK (method IN ('manual','qr','fingerprint','online')),
  checked_in_at  timestamptz,
  marked_by      uuid REFERENCES users(id) ON DELETE SET NULL,   -- actor (trainer/admin or the trainee themself)
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  UNIQUE (session_id, trainee_id)
);
CREATE INDEX attendance_trainee_idx ON attendance (trainee_id, created_at DESC);
CREATE TRIGGER attendance_touch BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------- LMS hierarchy ----------
CREATE TABLE courses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id  uuid NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  position      integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX courses_programme_idx ON courses (programme_id, position) WHERE deleted_at IS NULL;
CREATE TRIGGER courses_touch BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE modules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX modules_course_idx ON modules (course_id, position) WHERE deleted_at IS NULL;
CREATE TRIGGER modules_touch BEFORE UPDATE ON modules FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE lessons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id      uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title          text NOT NULL,
  lesson_type    text NOT NULL DEFAULT 'video' CHECK (lesson_type IN ('video','reading','document','quiz','live')),
  content        text,
  duration_min   integer CHECK (duration_min IS NULL OR duration_min >= 0),
  position       integer NOT NULL DEFAULT 0,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX lessons_module_idx ON lessons (module_id, position) WHERE deleted_at IS NULL;
CREATE TRIGGER lessons_touch BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE lesson_progress (
  lesson_id     uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  trainee_id    uuid NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  completed_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, trainee_id)
);
CREATE INDEX lesson_progress_trainee_idx ON lesson_progress (trainee_id);

-- Learning materials. file_id FK added in 0005 (files table defined there).
CREATE TABLE resources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  description     text,
  resource_type   text NOT NULL DEFAULT 'document' CHECK (resource_type IN ('document','video','link','presentation','other')),
  external_url    text,
  file_id         uuid,
  course_id       uuid REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id       uuid REFERENCES lessons(id) ON DELETE CASCADE,
  batch_id        uuid REFERENCES batches(id) ON DELETE CASCADE,
  uploaded_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  deleted_at      timestamptz,
  CHECK (file_id IS NOT NULL OR external_url IS NOT NULL)
);
CREATE INDEX resources_course_idx ON resources (course_id) WHERE deleted_at IS NULL;
CREATE INDEX resources_batch_idx  ON resources (batch_id)  WHERE deleted_at IS NULL;
CREATE TRIGGER resources_touch BEFORE UPDATE ON resources FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------- assessments ----------
CREATE TABLE assessments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       uuid REFERENCES batches(id) ON DELETE CASCADE,
  course_id      uuid REFERENCES courses(id) ON DELETE SET NULL,
  title          text NOT NULL,
  assessment_type text NOT NULL DEFAULT 'quiz' CHECK (assessment_type IN ('quiz','assignment','practical','final_exam')),
  total_marks    numeric(6,2) NOT NULL CHECK (total_marks > 0),
  pass_marks     numeric(6,2) NOT NULL CHECK (pass_marks >= 0),
  max_attempts   integer NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
  opens_at       timestamptz,
  due_at         timestamptz,
  questions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CHECK (pass_marks <= total_marks)
);
CREATE INDEX assessments_batch_idx ON assessments (batch_id) WHERE deleted_at IS NULL;
CREATE TRIGGER assessments_touch BEFORE UPDATE ON assessments FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE assessment_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  trainee_id     uuid NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  attempt_no     integer NOT NULL DEFAULT 1 CHECK (attempt_no > 0),
  answers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  score          numeric(6,2) CHECK (score IS NULL OR score >= 0),
  passed         boolean,
  status         text NOT NULL DEFAULT 'submitted' CHECK (status IN ('in_progress','submitted','graded')),
  graded_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  feedback       text,
  submitted_at   timestamptz,
  graded_at      timestamptz,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, trainee_id, attempt_no)
);
CREATE INDEX assessment_results_trainee_idx ON assessment_results (trainee_id);
CREATE TRIGGER assessment_results_touch BEFORE UPDATE ON assessment_results FOR EACH ROW EXECUTE FUNCTION touch_row();
