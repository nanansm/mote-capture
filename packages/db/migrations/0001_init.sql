-- Mote Capture initial schema (Sprint 1)
CREATE SCHEMA IF NOT EXISTS capture;

-- Booths registry
CREATE TABLE IF NOT EXISTS capture.booths (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  default_price INTEGER NOT NULL DEFAULT 30000,
  payment_provider TEXT NOT NULL DEFAULT 'ipaymu',
  bridge_token TEXT UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booths_active ON capture.booths(is_active);

-- Frames
CREATE TABLE IF NOT EXISTS capture.frames (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'regular' CHECK (tier IN ('regular', 'premium')),
  price INTEGER NOT NULL DEFAULT 30000,
  background_url TEXT,
  logo_url TEXT,
  preview_url TEXT,
  layout_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  booth_id TEXT REFERENCES capture.booths(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  season_start TIMESTAMP,
  season_end TIMESTAMP,
  sort_order INTEGER NOT NULL DEFAULT 0,
  uses_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_frames_active ON capture.frames(is_active);
CREATE INDEX IF NOT EXISTS idx_frames_booth ON capture.frames(booth_id);

-- Sessions (transaksi pelanggan)
CREATE TABLE IF NOT EXISTS capture.sessions (
  id TEXT PRIMARY KEY,
  booth_id TEXT NOT NULL REFERENCES capture.booths(id),
  frame_id TEXT REFERENCES capture.frames(id),
  status TEXT NOT NULL DEFAULT 'idle',
  amount INTEGER NOT NULL,
  payment_provider TEXT,
  payment_ref TEXT,
  qr_string TEXT,
  paid_at TIMESTAMP,
  customer_email TEXT,
  customer_phone TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,
  print_completed_at TIMESTAMP,
  download_token TEXT UNIQUE,
  download_expires_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expired_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_booth ON capture.sessions(booth_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON capture.sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_download_token ON capture.sessions(download_token);

-- Photos
CREATE TABLE IF NOT EXISTS capture.photos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES capture.sessions(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  is_final BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photos_session ON capture.photos(session_id);

-- Payment logs (audit)
CREATE TABLE IF NOT EXISTS capture.payment_logs (
  id SERIAL PRIMARY KEY,
  session_id TEXT,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_logs_session ON capture.payment_logs(session_id);
