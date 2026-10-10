-- 0003: akun pembayaran per booth.
--
-- Satu baris = satu akun Xendit/iPaymu (mis. "iPaymu smnanan", "Xendit Maja").
-- Kredensial disimpan sebagai satu amplop AES-GCM (lib/secret-box.ts) berisi
-- JSON, tidak pernah teks mentah. Booth memilih satu akun; sesi menyimpan akun
-- yang membuat QR-nya supaya webhook diverifikasi dengan akun yang sama walau
-- booth sudah dipindah ke akun lain di tengah jalan.
--
-- Additive saja (CREATE TABLE + ADD COLUMN). Aman untuk D1 prod berisi data.

CREATE TABLE IF NOT EXISTS payment_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('xendit', 'ipaymu')),
  mode TEXT NOT NULL DEFAULT 'production' CHECK (mode IN ('production', 'sandbox')),
  credentials TEXT NOT NULL,
  last_test_at INTEGER,
  last_test_ok INTEGER,
  last_test_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_payment_accounts_provider ON payment_accounts (provider);

ALTER TABLE booths ADD COLUMN payment_account_id TEXT REFERENCES payment_accounts(id);
ALTER TABLE sessions ADD COLUMN payment_account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_booths_payment_account ON booths (payment_account_id);
