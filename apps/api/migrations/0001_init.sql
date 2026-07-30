-- Mote Capture D1 schema (init).
-- Ported from packages/db/migrations/{0001_init,0002_sprint2,0003_voucher}.sql
-- (Postgres) to SQLite for Cloudflare D1. This is a brand-new, empty
-- database, so all three historical Postgres migrations are folded into one
-- init here rather than replayed incrementally.
--
-- Conversion rules applied:
--   - no `capture` schema / prefix (D1 has a single flat namespace)
--   - TIMESTAMP / TIMESTAMPTZ -> INTEGER (epoch milliseconds)
--   - BOOLEAN                -> INTEGER (0 / 1)
--   - JSONB                  -> TEXT (JSON-encoded)
--   - SERIAL                 -> INTEGER PRIMARY KEY AUTOINCREMENT
--   - `admins` table dropped (auth is env-var based, never had real rows)
--   - photos.url / frames.background_url / logo_url / preview_url now store
--     R2 object keys, not absolute URLs -> renamed to *_key

-- Booths registry
CREATE TABLE IF NOT EXISTS booths (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  default_price INTEGER NOT NULL DEFAULT 30000,
  payment_provider TEXT NOT NULL DEFAULT 'ipaymu',
  bridge_token TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_seen_at INTEGER,
  metadata TEXT DEFAULT '{}',
  payment_credentials TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_booths_active ON booths(is_active);

-- Frames
CREATE TABLE IF NOT EXISTS frames (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'regular' CHECK (tier IN ('regular', 'premium')),
  price INTEGER NOT NULL DEFAULT 30000,
  background_key TEXT,
  logo_key TEXT,
  preview_key TEXT,
  layout_json TEXT NOT NULL DEFAULT '{}',
  booth_id TEXT REFERENCES booths(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  season_start INTEGER,
  season_end INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  uses_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_frames_active ON frames(is_active);
CREATE INDEX IF NOT EXISTS idx_frames_booth ON frames(booth_id);

-- Sessions (transaksi pelanggan)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  booth_id TEXT NOT NULL REFERENCES booths(id),
  frame_id TEXT REFERENCES frames(id),
  status TEXT NOT NULL DEFAULT 'idle',
  amount INTEGER NOT NULL,
  payment_provider TEXT,
  payment_ref TEXT,
  qr_string TEXT,
  paid_at INTEGER,
  customer_email TEXT,
  customer_phone TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,
  print_completed_at INTEGER,
  download_token TEXT UNIQUE,
  download_expires_at INTEGER,
  metadata TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  expired_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_booth ON sessions(booth_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_download_token ON sessions(download_token);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_payment_ref ON sessions(payment_ref);

-- Photos
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  is_final INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_photos_session ON photos(session_id);

-- Payment logs (audit)
CREATE TABLE IF NOT EXISTS payment_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_payment_logs_session ON payment_logs(session_id);

-- App-level settings (key-value store)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Vouchers issued by admin (payment or discount, see apps/api/src/db/schema.ts
-- for the full semantics).
CREATE TABLE IF NOT EXISTS vouchers (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  type               TEXT NOT NULL,
  value              INTEGER NOT NULL,
  "limit"            INTEGER NOT NULL DEFAULT 1,
  used_count         INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'active',
  customer_name      TEXT,
  customer_email     TEXT,
  customer_whatsapp  TEXT,
  batch_id           TEXT,
  expires_at         INTEGER,
  created_by         TEXT,
  metadata           TEXT DEFAULT '{}',
  created_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS vouchers_code_idx   ON vouchers (code);
CREATE INDEX IF NOT EXISTS vouchers_status_idx ON vouchers (status);
CREATE INDEX IF NOT EXISTS vouchers_batch_idx  ON vouchers (batch_id);

-- Append-only ledger of every voucher redemption.
CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id         TEXT NOT NULL REFERENCES vouchers(id),
  session_id         TEXT NOT NULL,
  booth_id           TEXT NOT NULL,
  original_amount    INTEGER NOT NULL,
  final_amount       INTEGER NOT NULL,
  discount_applied   INTEGER NOT NULL,
  redeemed_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS voucher_redemptions_voucher_idx ON voucher_redemptions (voucher_id);
CREATE INDEX IF NOT EXISTS voucher_redemptions_session_idx ON voucher_redemptions (session_id);
