-- 0009: Part 5 certificates - holder name snapshot, tamper guard, default settings
-- Additive only. Shipped migrations 0001-0008 are untouched.

-- The name printed on a certificate must not change silently when the user later edits their profile.
ALTER TABLE certificates ADD COLUMN holder_name text;
UPDATE certificates c SET holder_name = u.full_name
  FROM trainees t JOIN users u ON u.id = t.user_id
 WHERE t.id = c.trainee_id AND c.holder_name IS NULL;
ALTER TABLE certificates ALTER COLUMN holder_name SET NOT NULL;

-- Defence in depth: identity fields of an issued certificate are immutable and a revoked certificate can never be revived.
-- Only status, revocation columns, file_id and the bookkeeping columns may change.
CREATE OR REPLACE FUNCTION certificates_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.certificate_no IS DISTINCT FROM OLD.certificate_no
     OR NEW.verification_code IS DISTINCT FROM OLD.verification_code
     OR NEW.trainee_id IS DISTINCT FROM OLD.trainee_id
     OR NEW.enrolment_id IS DISTINCT FROM OLD.enrolment_id
     OR NEW.programme_id IS DISTINCT FROM OLD.programme_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.holder_name IS DISTINCT FROM OLD.holder_name
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'certificate identity fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'a revoked certificate cannot be reinstated; issue a new one' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER certificates_guard_trg BEFORE UPDATE ON certificates FOR EACH ROW EXECUTE FUNCTION certificates_guard();

-- Default certificate settings. The Part 7 settings API will edit these; until then code falls back to the same defaults.
INSERT INTO system_settings (key, value, description, is_public) VALUES
  ('certificates.min_attendance_percent',     '75'::jsonb,     'Minimum attendance percentage required to issue a certificate (0-100)', false),
  ('certificates.require_assessments_passed', 'true'::jsonb,   'Every published or closed assessment of the batch must be passed', false),
  ('certificates.public_holder_name',         '"full"'::jsonb, 'Holder name on public verification: full, initials or none', false)
ON CONFLICT (key) DO NOTHING;
