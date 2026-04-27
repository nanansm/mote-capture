-- Sprint 1.5: voucher system (payment + discount vouchers, with redemption ledger)
--
-- Idempotent: safe to re-run. Statuses are TEXT (not pgEnum) to match the
-- existing capture.sessions / capture.payment_logs convention.

CREATE TABLE IF NOT EXISTS capture.vouchers (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  type               TEXT NOT NULL,                              -- 'payment' | 'discount'
  value              INTEGER NOT NULL,                           -- IDR for payment, % for discount
  "limit"            INTEGER NOT NULL DEFAULT 1,                 -- 0 = unlimited
  used_count         INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'active',             -- active | used | expired | disabled
  customer_name      TEXT,
  customer_email     TEXT,
  customer_whatsapp  TEXT,
  batch_id           TEXT,
  expires_at         TIMESTAMPTZ,
  created_by         TEXT,
  metadata           JSONB DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vouchers_code_idx     ON capture.vouchers (code);
CREATE INDEX IF NOT EXISTS vouchers_status_idx   ON capture.vouchers (status);
CREATE INDEX IF NOT EXISTS vouchers_batch_idx    ON capture.vouchers (batch_id);

CREATE TABLE IF NOT EXISTS capture.voucher_redemptions (
  id                 SERIAL PRIMARY KEY,
  voucher_id         TEXT NOT NULL REFERENCES capture.vouchers(id),
  session_id         TEXT NOT NULL,
  booth_id           TEXT NOT NULL,
  original_amount    INTEGER NOT NULL,
  final_amount       INTEGER NOT NULL,
  discount_applied   INTEGER NOT NULL,
  redeemed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS voucher_redemptions_voucher_idx ON capture.voucher_redemptions (voucher_id);
CREATE INDEX IF NOT EXISTS voucher_redemptions_session_idx ON capture.voucher_redemptions (session_id);
