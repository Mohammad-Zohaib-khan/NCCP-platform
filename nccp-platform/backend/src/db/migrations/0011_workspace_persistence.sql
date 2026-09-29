-- 0011: persistent workspace records across all 5 dashboards
CREATE TABLE workspace_records (
  id text PRIMARY KEY,
  workspace text NOT NULL,
  module text NOT NULL,
  data jsonb NOT NULL,
  status text NOT NULL DEFAULT 'Active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER touch_workspace_records BEFORE UPDATE ON workspace_records FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE INDEX idx_workspace_records_scope ON workspace_records (workspace, module);
