-- 0008: Part 4 revision (brief v3): localized LMS content, user language preference, verified attendance (QR / fingerprint / face)
-- Additive only. Shipped migrations 0001-0007 are untouched.

-- ---------- language preference (source of truth for the UI language; Part 9 reads/writes it) ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en'
  CHECK (preferred_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$');

-- ---------- localized course / module / lesson text ----------
-- One row per (content item, language). The base row (courses/modules/lessons) holds the default-language text;
-- progress stays on the underlying lesson, never on a translation.
CREATE TABLE content_translations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL CHECK (entity_type IN ('course','module','lesson')),
  entity_id    uuid NOT NULL,
  language     text NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  title        text NOT NULL,
  description  text,          -- courses only
  content      text,          -- lessons only
  updated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, language)
);
CREATE INDEX content_translations_lookup_idx ON content_translations (entity_type, language, entity_id);
CREATE TRIGGER content_translations_touch BEFORE UPDATE ON content_translations FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------- attendance: face method + minimal verification metadata ----------
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_method_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_method_check CHECK (method IN ('manual','qr','fingerprint','face','online'));
-- How the method was proven. Null for manual/online. 'fingerprint_simulated' exists only so demo rows stay identifiable.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS verification text
  CHECK (verification IS NULL OR verification IN ('qr_token','fingerprint_device','fingerprint_simulated','face_provider'));

-- ---------- attendance sessions: who opened attendance and the per-session QR signing secret ----------
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS attendance_opened_at  timestamptz;
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS attendance_opened_by  uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS attendance_closed_at  timestamptz;
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS attendance_closed_by  uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS qr_secret text;   -- never returned by any API; replaced on every (re)open
