-- Sprint 2: external integrations (settings, payment overrides, indexes)

-- App-level settings (key-value store)
CREATE TABLE IF NOT EXISTS capture.settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed default settings
INSERT INTO capture.settings (key, value) VALUES
  ('whatsapp', '{"enabled": false, "template": "Halo! 👋\n\nTerima kasih sudah berfoto di Maja Photobooth.\n\nFoto kamu siap di-download di sini:\n{link}\n\nLink berlaku 7 hari ya.\n\n— Maja Photobooth 📸"}'::jsonb),
  ('email', '{"enabled": false, "from_name": "Mote Capture", "subject": "Foto Kamu Sudah Siap! 📸"}'::jsonb),
  ('payment', '{"default_provider": "xendit"}'::jsonb),
  ('general', '{"booth_alert_offline_minutes": 5}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Per-booth payment credential override (allows different Xendit account per booth)
ALTER TABLE capture.booths
  ADD COLUMN IF NOT EXISTS payment_credentials JSONB DEFAULT '{}'::jsonb;

-- Helpful indexes for admin filtering
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON capture.sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_payment_ref ON capture.sessions(payment_ref);

-- Daily revenue rollup view (used in Sprint 5 reports)
CREATE OR REPLACE VIEW capture.daily_revenue AS
SELECT
  booth_id,
  DATE(created_at AT TIME ZONE 'Asia/Jakarta') AS date,
  COUNT(*) FILTER (WHERE status = 'done') AS sessions_done,
  COUNT(*) FILTER (WHERE status = 'failed') AS sessions_failed,
  SUM(amount) FILTER (WHERE status = 'done') AS revenue
FROM capture.sessions
GROUP BY booth_id, DATE(created_at AT TIME ZONE 'Asia/Jakarta');
