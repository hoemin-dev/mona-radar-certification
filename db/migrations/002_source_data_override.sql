CREATE TABLE IF NOT EXISTS certification_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  certification_type TEXT NOT NULL,
  certification_no TEXT NOT NULL,
  field_name TEXT NOT NULL,
  corrected_value TEXT NOT NULL,
  source_url TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(certification_type, certification_no, field_name)
);

CREATE TRIGGER IF NOT EXISTS certification_corrections_touch_updated_at
AFTER UPDATE ON certification_corrections
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE certification_corrections
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;
