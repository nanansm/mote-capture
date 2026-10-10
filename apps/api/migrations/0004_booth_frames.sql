-- 0004: frame & harga per booth.
--
-- Hirarki baru: booth -> frame. Satu frame (desain di library) bisa dipasang
-- di banyak booth, masing-masing dengan harga, status tampil, frame utama,
-- dan urutan sendiri. frames.booth_id / frames.price tidak dibaca lagi oleh
-- kode (kolom dibiarkan; DROP COLUMN di D1 berisiko untuk tabel berisi data).
--
-- Additive + backfill idempotent (INSERT OR IGNORE).

CREATE TABLE IF NOT EXISTS booth_frames (
  booth_id TEXT NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
  frame_id TEXT NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  price INTEGER NOT NULL CHECK (price >= 1000),
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (booth_id, frame_id)
);

CREATE INDEX IF NOT EXISTS idx_booth_frames_frame ON booth_frames (frame_id);

-- Harga 0 dulu berarti "ikut harga default booth" (resolvePrice lama).
-- Frame yang dulu dipasang ke satu booth.
INSERT OR IGNORE INTO booth_frames (booth_id, frame_id, price, is_active, is_default, sort_order)
  SELECT f.booth_id, f.id, CASE WHEN f.price > 0 THEN MAX(f.price, 1000) ELSE MAX(b.default_price, 1000) END, f.is_active, f.is_default, f.sort_order
  FROM frames f JOIN booths b ON b.id = f.booth_id;

-- Frame "semua booth" -> dipasang ke tiap booth yang ada.
INSERT OR IGNORE INTO booth_frames (booth_id, frame_id, price, is_active, is_default, sort_order)
  SELECT b.id, f.id, CASE WHEN f.price > 0 THEN MAX(f.price, 1000) ELSE MAX(b.default_price, 1000) END, f.is_active, f.is_default, f.sort_order
  FROM frames f CROSS JOIN booths b WHERE f.booth_id IS NULL;

-- Data lama bisa punya dua default (frame khusus booth + frame global).
-- Sisakan satu per booth: yang masuk duluan (frame khusus booth).
UPDATE booth_frames SET is_default = 0
  WHERE is_default = 1
    AND rowid NOT IN (SELECT MIN(rowid) FROM booth_frames WHERE is_default = 1 GROUP BY booth_id);
