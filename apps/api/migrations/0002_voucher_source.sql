-- 0002: sumber voucher + sesi asal (PRD bagian 8 #12, bagian 6).
--
-- source: manual | auto-late-payment | auto-abandoned | staff-cancel.
-- Baris lama = voucher buatan admin, jadi default 'manual' benar untuk semuanya.
-- source_session_id: sesi yang memicu voucher otomatis/staff-cancel; NULL
-- untuk manual.
--
-- Unique index parsial = idempotensi: satu sesi maksimal satu voucher per
-- sumber otomatis. Webhook Xendit yang dikirim ulang, alarm DO yang
-- di-retry, atau dobel tap staf tidak bisa menerbitkan voucher kedua.
-- 'manual' dikecualikan (source_session_id NULL, dan NULL tidak pernah
-- bentrok di UNIQUE SQLite).
--
-- Additive saja (ADD COLUMN + CREATE INDEX). Aman dijalankan ke D1 prod
-- berisi data; tidak ada rewrite tabel.

ALTER TABLE vouchers ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE vouchers ADD COLUMN source_session_id TEXT;

CREATE INDEX IF NOT EXISTS vouchers_source_idx ON vouchers (source);
CREATE INDEX IF NOT EXISTS vouchers_source_session_idx ON vouchers (source_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_source_session_uniq
  ON vouchers (source_session_id, source)
  WHERE source_session_id IS NOT NULL;
