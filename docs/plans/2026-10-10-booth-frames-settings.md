# Plan: Frame & harga per booth + menu Settings tunggal

Disetujui Nanan 10 Okt 2026 ("ya harga beda beda per booth nya ... kerjakan sekarang").

## Masalah
- Hirarki terbalik: frame dibuat lalu "ditempel" ke booth lewat dropdown `frames.booth_id`.
- Satu frame hanya bisa 1 booth atau semua booth. Harga melekat di frame, jadi frame sama tidak bisa beda harga antar booth.
- Payments + WhatsApp + Settings tersebar di 3 menu.

## Desain
### Data (migrasi 0004, additive)
`booth_frames (booth_id, frame_id, price, is_active, is_default, sort_order)`, PK (booth_id, frame_id), cascade.
- Backfill: frame ber-`booth_id` -> 1 baris; frame `booth_id NULL` ("semua booth") -> 1 baris per booth. Harga = `frames.price`.
- `frames.booth_id` & `frames.price` tidak dibaca lagi (kolom dibiarkan, D1 drop column berisiko).
- `frames.is_active` = arsip global (frame mati di semua booth). Musim (season) tetap di frame.

### Aturan
- Harga sesi = `booth_frames.price`. Frame tidak terpasang / dimatikan di booth -> ditolak "Frame tidak dipasang untuk booth ini".
- Satu frame utama per booth (set utama = lepas utama lain, satu batch).
- Harga min Rp1.000, bulat ribuan tidak dipaksa (Rp1.000 untuk tes).
- `booths.default_price` = isian awal saat pasang frame + fallback. Kiosk "mulai dari" = harga termurah frame aktif.
- Hapus frame dari library ditolak kalau masih terpasang di booth (sebut nama booth). Lepas dulu.

### API
- `GET /api/booths/:id/frames` daftar frame booth + data frame.
- `PUT /api/booths/:id/frames/:frameId` pasang/ubah {price, isActive, isDefault}.
- `DELETE /api/booths/:id/frames/:frameId` lepas.
- `POST /api/booths/:id/frames/reorder` {frameIds}.
- `POST /api/frames` dengan `boothId`+`price` -> buat + langsung pasang (satu batch).
- `GET /api/frames` tambah `booths: [{id,name,price}]` untuk kolom "Dipakai di".

### UI
- Booth detail: tab **Frame & Harga** (default) · **Info & Pembayaran** · **Status**. `?tab=` deep link.
  - Baris frame: preview, nama, input harga Rp (simpan saat blur/Enter), switch Tampil, tombol Utama, naik/turun, Lepas.
  - "Unggah frame baru" -> `/admin/frames/new?booth=ID` (field harga untuk booth itu), balik ke tab Frame.
  - "Ambil dari Library" -> dialog frame yang belum terpasang, isi harga, Pasang.
  - Empty state + peringatan kalau nol frame aktif.
- Menu Frame -> **Library Frame**: tanpa kolom harga/booth target; kolom "Dipakai di".
- **Settings** satu halaman, section bisa dibuka-tutup: Pembayaran · WhatsApp · Email & Umum. Hash `#pembayaran` dst. `/admin/payments` & `/admin/whatsapp` redirect.

## Tes
- API: frame sama 2 booth harga beda (boot + amount sesi), frame tak terpasang ditolak, nonaktif tersembunyi, utama tunggal, reorder, validasi harga, buat+pasang, hapus terpakai ditolak.
- Migrasi: D1 lokal state lama -> 0004 -> cek backfill.
- Kiosk e2e, admin probe Playwright + review visual.
