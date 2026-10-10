-- 0005: izinkan provider 'doku' di payment_accounts.
--
-- SQLite tidak bisa mengubah CHECK lewat ALTER, jadi tabel dibangun ulang
-- dengan pola resmi SQLite (buat baru -> salin -> hapus lama -> ganti nama).
-- booths.payment_account_id mereferensikan tabel ini; defer_foreign_keys
-- menunda cek FK sampai akhir transaksi migrasi (cara yang dianjurkan D1).
-- Data akun & id tidak berubah, jadi booth dan sesi tetap menunjuk akun sama.

PRAGMA defer_foreign_keys = true;

CREATE TABLE payment_accounts_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('xendit', 'ipaymu', 'doku')),
  mode TEXT NOT NULL DEFAULT 'production' CHECK (mode IN ('production', 'sandbox')),
  credentials TEXT NOT NULL,
  last_test_at INTEGER,
  last_test_ok INTEGER,
  last_test_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO payment_accounts_new (id, name, provider, mode, credentials, last_test_at, last_test_ok, last_test_message, created_at, updated_at)
  SELECT id, name, provider, mode, credentials, last_test_at, last_test_ok, last_test_message, created_at, updated_at FROM payment_accounts;

DROP TABLE payment_accounts;
ALTER TABLE payment_accounts_new RENAME TO payment_accounts;

CREATE INDEX IF NOT EXISTS idx_payment_accounts_provider ON payment_accounts (provider);

PRAGMA defer_foreign_keys = false;
