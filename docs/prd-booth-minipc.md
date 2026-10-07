# PRD: booth mote-capture di mini PC, target 30 sesi/hari tanpa staf di depan layar

Status: draft 3, 30 Sep 2026. Owner: Nanan. Semua keputusan di dokumen ini sudah dikunci owner. Yang belum pasti hanya angka bertanda `[TARGET, validasi]` dan 7 hal teknis di bagian 15. Tidak ada lagi `[PENDING OWNER]` dan tidak ada `[BUTUH DATA]`.

Perubahan draft 2 → 3: PIN staf 4 digit (bagian 6, 11); timer restart malam dihapus, diganti siklus listrik harian (bagian 12, 13); angka slot layout default dikunci (bagian 8); jadwal tahap tanpa tanggal, M4 dimulai saat perangkat tiba (bagian 14); 9 rujukan kode dikoreksi setelah dicek ke commit `a45d307` (bagian 8 #2, #9, #14, #15, #17, #18; bagian 9 unggahan; bagian 11 rotasi token).

Cabang kode acuan: `feat/cloudflare-migration`. Semua rujukan `file:baris` mengacu ke commit `a45d307`.

---

## 1. Booth harus lolos 30 sesi/hari, sesi selesai di bawah 2 menit 30 detik, tanpa barista pegang layar

Booth ini dipasang di kedai kopi milik sendiri. Satu booth, layar sentuh saja, nyala lebih dari 12 jam sehari. Harga Rp30.000 per sesi. Barista bukan operator. Dia cuma dipanggil kalau layar bilang "panggil barista", waktu isi kertas, atau waktu kasih kode voucher.

Yang dibangun ulang: sisi booth (mini PC, kamera, printer). Sisi cloud (Cloudflare) dipertahankan dan diperbaiki di titik yang disebut bagian 8.

| Metrik | Target | Cara ukur | Catatan |
|---|---|---|---|
| Sesi per hari | 30 | hitung `sessions.status = done` per hari di D1 | angka bisnis dari owner |
| Omzet booth per hari | Rp900.000 | 30 × Rp30.000 | turunan |
| Durasi sesi (pilih frame → layar QR), median | ≤ 2 menit 30 detik | timestamp DO per tahap | `[TARGET, validasi]` |
| Durasi sesi kalau 4 foto diulang semua | ≤ 3 menit 30 detik | sama | `[TARGET, validasi]` |
| Waktu 2 lembar keluar dari printer setelah composite jadi | ≤ 120 detik | log `print.status` agent | `[TARGET, validasi]`, spesifikasi Canon CP1500 ±41 detik per lembar 4R |
| Waktu link foto bisa dibuka setelah composite jadi | ≤ 60 detik | log `upload.status` agent | `[TARGET, validasi]` |
| Foto gagal ditangkap (shutter tidak jadi) | < 1% dari semua jepretan | event `photo.failed` ÷ `photo.ready` | `[TARGET, validasi]` lewat uji 50× jepret |
| Lembar gagal cetak | < 2% dari semua lembar | `print.status = failed` ÷ total job | `[TARGET, validasi]` |
| Sesi yang butuh barista turun tangan | < 5% per hari | jumlah masuk halaman staf per hari | `[TARGET, validasi]` |
| Uang hilang (dibayar tapi tidak dapat foto dan tidak dapat voucher) | 0 | audit `paymentLogs` vs `sessions` vs voucher otomatis | keras, bukan target |

---

## 2. Scope mencakup 9 hal, 9 hal sengaja dikeluarkan

| Masuk scope | Keluar scope (jangan dibahas ulang) |
|---|---|
| `booth-agent` baru (Node 22) di mini PC, termasuk reverse proxy `/api/*` dan `/ws/*` ke Workers | mode offline apa pun |
| Kiosk Chromium (cage, Wayland) disajikan dari mini PC | kirim WhatsApp |
| Layout frame v2 1200×1800, 4 slot | filter foto, B&W |
| Alur retake 1× per foto | Electron, `apps/bridge` |
| Cetak 2 lembar 4R via CUPS + Gutenprint 5.3.6 | UPS |
| Antrean upload SQLite → R2 | kabin, LED |
| Penghitung kertas & tinta + peringatan di layar | fallback webcam kalau DSLR mati |
| Halaman staf ber-PIN (reset kamera, cetak ulang, batal + voucher) | VPS di produksi, auto-update malam, sistem rollback |
| Perbaikan bug cloud yang tercantum di bagian 8 | login kasir |
| | timer restart malam; booth dimatikan tiap tutup kedai (bagian 12) |

---

## 3. Perangkat keras 8 komponen, 3 di antaranya dibeli bersamaan dan menjadi pemicu M4

| Komponen | Peran | Koneksi |
|---|---|---|
| Beelink EQR6 (Ryzen 9 6900HX, 24 GB / 512 GB) | host `booth-agent`, kiosk, CUPS; Claude Code untuk operasi jarak jauh | listrik, wifi |
| Canon EOS 2000D + kit 18-55 | tangkapan final via `gphoto2` | USB mini 1.5 m → hub |
| ACK-E10 dummy battery | kamera nyala 12 jam tanpa ganti baterai | listrik |
| Logitech Brio 100 | live preview saja, tidak pernah dipakai untuk foto final | USB → hub |
| Acer PM161QT | layar sentuh pelanggan | USB-C / HDMI + USB touch |
| M-Tech powered hub 7 port | satu titik colok kamera, Brio, touch | USB ke mini PC |
| Canon Selphy CP1500 | cetak 4R dye-sub | USB → hub, atau langsung ke mini PC (lihat 15) |
| Epson L355 | cetak uji waktu development saja, tidak dipakai di kedai | USB |

EQR6, 2000D, dan CP1500 belum dibeli; ketiganya dibeli sekaligus, dan hari barang tiba adalah hari M4 dimulai (bagian 14). Sampai saat itu M1 sampai M3 jalan di VPS dengan mock.

Tidak ada UPS dan tidak ada router khusus saat ini. Listrik padam = booth mati, ditangani lewat alur uang di bagian 10. Booth juga dimatikan tiap malam lewat tombol power (bagian 12), jadi jalur pemulihan setelah mati listrik dan jalur nyala pagi adalah kode yang sama.

---

## 4. Arsitektur terdiri dari 3 komponen, tiap state punya tepat 1 pemilik

```
[Pelanggan] → layar sentuh
                 │
   Chromium kiosk (cage) ── http://127.0.0.1:7777/  (UI kiosk apps/web, build statis, disajikan oleh booth-agent)
        │ fetch + ws, semua URL relatif (satu origin)
        ▼
   booth-agent :7777 ──── proxy /api/* dan /ws/* (termasuk upgrade ws) ───▶ Cloudflare Workers (apps/api)
   ├─ gphoto2 (single-flight)                                              ├─ BoothDO (uang, status sesi, done)
   ├─ sharp compose 1200×1800                                              ├─ D1 (sessions, photos, vouchers, frames)
   ├─ CUPS lp × 2 job                                                      ├─ R2 (foto, composite)
   ├─ SQLite (queue, counters)                                             ├─ Xendit QRIS + webhook
   └─ Brio MJPEG preview                                                   └─ admin web (apps/web) + share page
```

| State | Pemilik tunggal | Siapa lagi yang baca |
|---|---|---|
| Uang: status pembayaran, voucher terpakai, refund | BoothDO + D1 | kiosk (tampil), admin |
| Status sesi `payment → paid → capturing → done` | BoothDO; `done` hanya lewat `POST /api/bridge/session/:id/done` dari agent | kiosk, agent (lapor) |
| Progres tangkapan: foto ke berapa, sudah retake atau belum | `booth-agent` | kiosk (tampil), DO menerima hasil akhir saja |
| File foto mentah dan composite | `booth-agent` (disk lokal, lalu R2) | share page lewat R2 |
| Antrean cetak, status per lembar | `booth-agent` + CUPS | kiosk, halaman staf |
| Antrean upload ke R2 | `booth-agent` (SQLite) | share page lewat status `uploading` |
| Penghitung kertas & tinta | `booth-agent` (SQLite) | kiosk (peringatan), halaman staf |
| PIN staf | `booth-agent` (hash di SQLite) | tidak ada |
| Frame aktif + layout | D1 lewat admin | kiosk (pilih), agent (compose, cache lokal) |

Aturan pembagian yang mengunci konflik `booth.ts:560` (DO mengabaikan indeks foto yang sudah pernah diterima): DO tidak lagi menerima foto satu per satu sebagai penentu progres. Agent yang memegang progres tangkapan termasuk retake. DO menerima dua sinyal saja: pesan ws `capture:start` (`SocketEvents.START_CAPTURE`, sudah ada, `booth.ts:347`) sekali dari kiosk, dan `markDone` sekali dari agent lewat `POST /api/bridge/session/:id/done`. Unggahan foto dan composite ke R2 tidak mengubah status sesi.

Status sesi di DO setelah perubahan ini: `payment → paid → capturing → done`, plus status akhir `expired`, `abandoned_paid`, `stale`, `cancelled`, `failed`. Status `processing` tidak lagi diproduksi DO (dulu diset `booth.ts:860` saat foto ke-3 masuk); "processing" hanya ada sebagai fase lokal di agent.

Kode kiosk memakai URL relatif: `API_BASE = "/api"` (`apps/web/src/lib/api.ts:10`) dan ws dari `window.location.host` (`apps/web/src/components/kiosk/kiosk-shell.tsx:46`). Kode itu tidak diubah. `booth-agent` meneruskan `/api/*` dan `/ws/*` (termasuk upgrade websocket) ke origin Workers lewat env `API_ORIGIN`. Semua panggilan kiosk satu origin `http://127.0.0.1:7777`: tanpa CORS, tanpa prompt Local Network Access (diuji di T3).

Pola yang dipinjam dari PhotoboothProject (MIT): satu proses `gphoto2` tidak boleh berjalan bersamaan dengan proses lain yang menyentuh kamera (single-flight), alur retake per slot, dan urutan setup CUPS. Kodenya tidak dipakai.

---

## 5. Alur pelanggan lewat 9 layar, tiap layar punya timeout

| # | Layar (state kiosk) | Isi | Aksi pelanggan | Timeout → ke mana |
|---|---|---|---|---|
| 1 | `IDLE` | attract screen | sentuh | tidak ada |
| 2 | `PILIH_FRAME` | 4 frame per halaman, tombol prev/next, tanpa batas jumlah frame, hanya frame `isActive` | pilih frame | 5 menit tanpa sentuhan → `IDLE` |
| 3 | `KONFIRMASI` | frame terpilih, harga Rp30.000, pilih QRIS atau voucher | pilih metode | 5 menit → `IDLE` |
| 4a | `PAYMENT` (QRIS) | QR Xendit, hitung mundur 60 detik | scan dan bayar | 60 detik → `IDLE`, QR Xendit ikut kedaluwarsa (`expires_at` 60 detik) |
| 4b | `VOUCHER_INPUT` | keypad kode | ketik kode | 5 menit → `IDLE`; kode salah 5× → kembali `KONFIRMASI` |
| 5 | `PEMBAYARAN_OK` | "Pembayaran berhasil", tombol "Mulai Foto"; tidak maju otomatis | tekan "Mulai Foto" | tekan → kiosk `POST /session/start` ke agent, lalu ws `capture:start` ke DO, lalu `COUNTDOWN` dengan fase "Siap-siap" 10 detik (`GET_READY_MS`); 3 menit tanpa tekan → `IDLE`, alarm DO menerbitkan voucher otomatis |
| 6 | `COUNTDOWN` × 4 | preview Brio, hitung mundur 5 detik, lalu teks "TAHAN!", layar kedip saat `shutter_fired` | pose | `shutter_fired` → `REVIEW_SHOT`; 15 detik tanpa `photo.ready` → `CALL_STAFF` |
| 7 | `REVIEW_SHOT` × 4 | foto barusan, tombol "Ulangi" (hilang setelah dipakai 1× untuk foto itu) | tekan "Ulangi" atau diam | 5 detik → foto berikutnya; setelah foto ke-4 kiosk `POST /session/:id/compose` lalu → `PROCESSING` |
| 8 | `PROCESSING` → `PRINTING` | teks lama `kiosk.processing.title` ("Lagi nyiapin hasil cetakmu...", `apps/web/src/lib/i18n/dictionary.ts:64`) | tidak ada | `compose.done` → `DONE`; 20 detik tanpa `compose.done` → `CALL_STAFF` |
| 9 | `DONE` | QR ke share page, kalimat "foto lagi dicetak, tunggu di depan printer"; peringatan kertas/tinta kalau ada; tombol "Selesai" | scan QR, tekan "Selesai" | 60 detik atau tombol "Selesai" → `IDLE`; cetak dan upload jalan terus di belakang |

Layar 1 sampai 3 diblokir kalau `camera.status.connected = false`: attract screen tetap tampil, tombol mulai diganti teks "Booth sedang disiapkan, panggil barista". Uang tidak boleh masuk kalau kamera sudah diketahui mati. Printer mati tidak memblokir (pelanggan tetap dapat foto lewat QR; lihat bagian 10 #10).

Detail tahap tangkapan (langkah 6):

1. Saat "Mulai Foto" ditekan, kiosk memanggil agent dulu, `POST /session/start {sessionId, frameId}`; agent balas 409 kalau kamera tidak terdeteksi (kiosk → `CALL_STAFF`, sesi tetap `paid`, alarm 3 menit DO tetap jalan). Kalau 200, kiosk kirim ws `capture:start {sessionId}` ke DO; DO balas error kalau status bukan `paid` (misalnya alarm sudah menandai `abandoned_paid`): kiosk tampil "Waktu habis, voucher otomatis sudah diterbitkan, hubungi barista" 10 detik lalu `IDLE`. Per foto, kiosk kirim `POST /session/:id/capture {slot}` ke agent tepat saat angka hitung mundur habis; DO tidak ikut. Kiosk langsung tampil "TAHAN!".
2. Agent spawn `gphoto2 --capture-image-and-download`. Waktu spawn 1 sampai 3 detik dan tidak stabil, jadi tidak ada trik offset 0,4 detik. Kedip layar mengikuti event `shutter_fired` dari agent, bukan timer.
3. Agent kirim `photo.ready {slot, thumbUrl}`; kiosk pindah ke `REVIEW_SHOT`.
4. "Ulangi" hanya boleh 1× per slot. Agent yang menghitung; kiosk yang menyembunyikan tombol. Foto lama ditimpa di slot yang sama.
5. Setelah `REVIEW_SHOT` slot 4 selesai (5 detik habis atau retake slot 4 sudah dipakai dan foto ulangnya sudah `photo.ready`), kiosk memanggil `POST /session/:id/compose`. Agent tidak memulai compose sendiri.

Sesi dianggap `done` di DO begitu composite tersimpan di disk mini PC: agent memanggil `POST /api/bridge/session/:id/done`, DO menjalankan RPC `markDone`. Cetak dan upload tidak menahan pelanggan. Event `compose.done` ke kiosk dipancarkan setelah file composite tersimpan, tanpa menunggu balasan `/done`; panggilan `/done` masuk antrean yang sama dengan unggahan (bagian 9) supaya gangguan wifi sesaat tidak menahan layar.

Pemulihan kalau kiosk mati di tengah sesi (Chromium restart, bagian 10 #12): kiosk menyimpan `{sessionId, state}` di `localStorage` tiap pindah state. Saat boot, kiosk membaca `activeSession` dari `KIOSK_READY` DO (bagian 8 #18) dan `activeSession` dari `GET /health` agent. Aturan: agent punya sesi aktif → lanjut ke `COUNTDOWN` slot `nextSlot` dari agent; agent kosong tapi DO bilang `paid` → `PEMBAYARAN_OK` dengan tombol "Mulai Foto"; DO bilang `payment` → `PAYMENT` dengan QR yang sama kalau `expiresAt` belum lewat; kondisi lain → `IDLE`.

`downloadToken` untuk QR share dikirim DO ke kiosk di event `PAYMENT_PAID` (juga untuk voucher yang menutup penuh), jadi layar `DONE` menggambar QR seketika, tanpa menunggu unggahan R2.

Share page (langkah 9): kalau composite belum sampai di R2, halaman menampilkan "Fotomu sedang diunggah, coba buka lagi sebentar" dengan auto-refresh 10 detik, bukan error. Link berlaku 7 hari (`apps/api/src/lib/env.ts:42`, `DOWNLOAD_LINK_EXPIRY_DAYS=7`).

---

## 6. Staf dapat 1 halaman ber-PIN dengan 5 aksi, admin tetap 1 login email

Halaman staf dibuka dari kiosk dengan menyentuh pojok kiri atas 5× dalam 3 detik, atau lewat tombol "Barista" di layar `CALL_STAFF`. Masuk pakai PIN 4 digit; nilainya diset owner lewat `booth-agent set-pin` di mini PC dan tidak disimpan di repo. Pelanggan tidak pernah melihat keypad PIN: layar pelanggan mulai dari sentuh/tombol mulai di `IDLE`. Dengan 4 digit, kunci 5 menit setelah 5 kali salah adalah satu-satunya rem, jadi angka itu tidak boleh dilonggarkan.

| Aksi staf | Yang terjadi | Efek ke uang |
|---|---|---|
| Reset kamera | agent `sudo usbreset <bus/dev Canon>` (bus/dev dicari dari `idVendor 04a9` di `/sys/bus/usb/devices`; sudoers `/etc/sudoers.d/booth-agent`: `booth ALL=(root) NOPASSWD: /usr/bin/usbreset`), tunggu 5 detik, `gphoto2 --summary`; kalau OK sesi lanjut dari slot yang gagal | tidak ada |
| Batalkan sesi + terbitkan voucher | agent minta API `POST /api/bridge/session/:id/cancel-voucher` (bearer `booths.bridge_token`); DO ubah sesi jadi `cancelled`, D1 buat voucher 1× pakai nilai Rp30.000, kode tampil di layar staf untuk dicatat barista | pelanggan dapat voucher, tercatat di admin |
| Cetak ulang per lembar | pilih sesi dari 20 sesi terakhir (thumbnail composite), pilih lembar 1 atau 2, `lp` 1 job | tidak ada, tapi kertas berkurang 1 |
| Isi ulang kertas / tinta | tombol "+18 lembar", "+36 lembar", "ganti kartrid tinta (36)"; angka penghitung diset | tidak ada |
| Lihat status | kamera terdeteksi, printer `idle/printing/stopped`, antrean upload tertunda, sisa kertas & tinta | tidak ada |

Alur admin (apps/web, login email + sandi di `apps/api/src/middleware/admin.ts`, tanpa role):

| Aksi admin | Sudah ada | Perubahan |
|---|---|---|
| Buat voucher, lihat status active/used/expired/disabled | ya (`voucher.ts`) | tambah kolom sumber: `manual`, `auto-late-payment`, `auto-abandoned`, `staff-cancel`, plus sesi asal |
| Aktif/nonaktif frame, urutan, musim | ya (`schema.ts` `isActive`, `sortOrder`, `seasonStart/End`) | validasi layout v2 saat upload |
| Reset sesi | ya (`session-admin.ts:39-57`) | tetap |
| Refund (catat saja, tanpa panggil Xendit) | ya (`booth.ts:791-828`) | terima alasan `PRINT_FAILED`, `EXPIRED_PAID`, `CAMERA_FAILED`; boleh untuk sesi `done` tanpa mengubah status, link share tetap hidup |
| Lihat penghitung kertas/tinta booth | belum | agent kirim ikut heartbeat (`bridge.ts:122`) |

PIN staf diatur di mini PC lewat CLI `booth-agent set-pin` (Tailscale SSH). Tidak ada endpoint admin dan tidak ada PIN di D1. Selama M2 dan M3 di VPS, PIN mock diset lewat perintah yang sama di agent mock.

Voucher otomatis (`auto-late-payment`, `auto-abandoned`) dan voucher `staff-cancel` dibuat dengan `type = "payment"`, `value = sessions.amount`, `limit = 1`, `expiresAt = null` (tanpa masa berlaku; di admin tampil hijau selama belum terpakai, merah setelah terpakai, seperti daftar voucher Selfbooth), `batchId = null`, `createdBy = "system:<sumber>"` (kolom di `db/schema.ts:176-193`).

Voucher dipegang barista dalam bentuk kode tercetak. Tidak ada login kasir. Admin melihat kode mana yang sudah terpakai.

---

## 7. State machine kiosk nambah 5 state dan buang 2, BoothDO nambah 4 alarm

State kiosk sekarang (`apps/web/src/lib/kiosk/state-machine.ts:3-14`): `IDLE, PILIH_FRAME, KONFIRMASI, VOUCHER_INPUT, PAYMENT, PEMBAYARAN_OK, COUNTDOWN, PROCESSING, PREVIEW, INPUT_KONTAK, DONE`.

| Perubahan | Detail |
|---|---|
| Tambah `REVIEW_SHOT` | setelah tiap `photo.ready`, membawa `slot`, `retakeUsed` |
| Tambah `PRINTING` | gabung visual dengan `PROCESSING`, beda hanya sumber event (`compose.done` sudah lewat, tunggu tidak lagi menahan) |
| Tambah `PRINT_FAILED` | tampil di atas `DONE` sebagai banner "Cetakan bermasalah, panggil barista", QR tetap tampil |
| Tambah `CALL_STAFF` | layar penuh "Panggil barista ya", tombol "Barista" ke halaman PIN |
| Tambah `STAFF` | halaman PIN dan 5 aksi di bagian 6 |
| Hapus `PREVIEW` | fungsinya digantikan `REVIEW_SHOT` per foto |
| Hapus `INPUT_KONTAK` | tanpa WhatsApp, tanpa input kontak |
| `CountdownPhase` | tetap `GET_READY / COUNTDOWN / CHEESE`; `CHEESE` sekarang berakhir oleh event `shutter_fired`, bukan `CHEESE_HOLD_MS` |

Alarm BoothDO per tahap. Blokir sesi baru di `booth.ts:405-413` tetap ada (uang sudah masuk, booth memang harus terkunci), yang berubah: blokir itu sekarang berbatas waktu lewat alarm, dan `session:create` saat terkunci balas error `BOOTH_BUSY` dengan `releasesAt` (kiosk tampil "booth sedang dipakai" plus hitung mundur):

| Status sesi | Alarm | Saat alarm bunyi |
|---|---|---|
| `payment` | 60 detik (`qr_expiry`, sudah ada `booth.ts:497`) | status → `expired`, kiosk → `IDLE` |
| `paid`, belum ada `capture:start` ("Mulai Foto" belum ditekan) | 3 menit sejak `paidAt` | status → `abandoned_paid`, terbitkan voucher otomatis Rp30.000 (sumber `auto-abandoned`, tetap berlaku), kiosk → `IDLE`, booth bebas |
| `capturing` | 10 menit sejak `capture:start`, dibatalkan oleh `markDone` | status → `stale`, voucher otomatis (sumber `auto-abandoned`), booth bebas |

DO tidak menerima event per foto, jadi alarm `capturing` berjalan datar 10 menit; sesi terlama yang sah (4 retake) selesai di bawah 4 menit. Kalau `markDone` datang setelah sesi sudah `stale` (misalnya wifi putus lama lalu pulih): voucher otomatis sesi itu belum terpakai → status jadi `done`, voucher dinonaktifkan (`vouchers.status = "disabled"`, `metadata.disabledReason = "late-done"`), balas 200; voucher sudah terpakai → balas `409 SESSION_STALE`, status tetap `stale`, agent tidak mencetak (bagian 10 #15). Pelanggan tidak pernah dapat cetakan dan voucher sekaligus.

Alarm tahap adalah tipe baru di `AlarmTask` (`do/booth.ts:99-103`): `{type: "paid_timeout", sessionId}` dan `{type: "capture_timeout", sessionId}`, dijalankan lewat dispatcher alarm tunggal yang sudah ada (`do/booth.ts:925`, satu alarm per DO). Satu booth hanya punya satu sesi aktif, jadi satu alarm cukup. Cron 5 menit di `scheduled.ts:118-137` hanya menyapu status `payment` dan tidak perlu diubah.

Voucher otomatis tampil di admin dengan sesi asalnya. Barista menyerahkan kodenya ke pelanggan yang komplain.

---

## 8. Kode cloud berubah di 18 titik, semua dengan file dan baris

Semua path relatif dari `apps/api/src/` kecuali ditulis lengkap.

| # | File:baris | Sekarang | Jadi |
|---|---|---|---|
| 1 | `do/booth.ts:57` | `TOTAL_PHOTOS = 3` | `4` |
| 2 | `do/booth.ts:73-77` (`startCaptureSchema`), `:533-590` (`handleStartCapture`), `:347` | DO menerima `photoIndex` per foto lewat ws `capture:start` dan mendorong `BRIDGE_CAPTURE` | tidak ada path HTTP baru; ws `capture:start` (`SocketEvents.START_CAPTURE`) tetap dipakai, hanya sekali per sesi: hapus `photoIndex` dan cabang `photoIndex > 1`, set `capturing`, pasang alarm `capture_timeout`; tangkapan per foto kiosk → agent |
| 3 | `do/booth.ts:560`, `do/booth.ts:858` | abaikan indeks foto yang sudah diterima; `received.size < TOTAL_PHOTOS` menentukan lanjut ke composite | hapus; progres milik agent, unggahan foto tidak mengubah status |
| 4 | `do/booth.ts:469` | `createQR expiresInMinutes: 5` | `1`; `lib/payment/xendit.ts:74` sudah kirim `expires_at`, cukup ikut nilai baru |
| 5 | `do/booth.ts:696-706` | `markPaid` diam kalau status ≠ `payment` | kalau status `expired` dan webhook `PAID` datang: catat di `paymentLogs`, buat voucher otomatis (sumber `auto-late-payment`), balas 200 ke Xendit |
| 6 | `do/booth.ts:405-413` | tolak sesi baru selama sesi lama `paid/capturing/processing`, tanpa batas waktu | penolakan tetap, tapi balas `{error: "BOOTH_BUSY", releasesAt}`; alarm per tahap (bagian 7) yang membebaskan; tambah status `abandoned_paid`, `stale`, `cancelled` |
| 7 | `do/booth.ts:791-828` | refund no-op kecuali status `paid/capturing/processing` (`booth.ts:798`) dan set status `failed` (`booth.ts:805-806`), sehingga share balas 425 | boleh untuk `done`; refund tidak mengubah status sesi `done`, cukup catat di `metadata` dan `paymentLogs`, link share tetap hidup; tambah enum alasan `PRINT_FAILED`, `EXPIRED_PAID`, `CAMERA_FAILED`, `MANUAL`; tetap tanpa panggilan refund Xendit |
| 8 | `routes/voucher.ts:462-470` | `markPaid` dipanggil walau `finalAmount > 0` | booth hanya menerima voucher yang menutup harga penuh: kalau `finalAmount > 0`, `/redeem` balas 400 "voucher tidak berlaku di booth" dan tidak memanggil `markPaid`; tanpa QR sisa |
| 9 | `routes/voucher.ts:294` `/redeem` | tanpa rate limit | maks 5 percobaan per sesi, 30 percobaan per booth per 10 menit; lewat batas balas 429. Penghitung disimpan di storage BoothDO lewat RPC baru `checkRedeemAttempt(boothId, sessionId)` (kunci `redeem:session:<id>` dan `redeem:booth`, jendela geser 10 menit); bukan KV, karena `wrangler.jsonc` tidak punya binding KV dan tidak ditambah |
| 10 | `routes/share.ts:64-66` | balas 425 sampai `done` | `done` tapi composite belum di R2 → balas 200 dengan `state: "uploading"`; halaman tampil "sedang diunggah" |
| 11 | `lib/validations/frame.ts:18-24`, `:28-41`; tipe `FrameLayout` di `packages/shared/src/types/frame.ts:13-19` | `frameLayoutSchema` berbentuk `photoSlots{stripIndex,photoIndex}`, `stripCount`, `cutLineX`; `DEFAULT_LAYOUT_B` 1800×1200, 6 slot | `discriminatedUnion` pada `version`: 1 = bentuk lama, 2 = `{canvasWidth, canvasHeight, slots[4]{x,y,w,h}, artworkKey}`; `DEFAULT_LAYOUT_V2` 1200×1800, 4 slot; frame baru wajib `version: 2`; kiosk hanya menampilkan frame v2, frame lama tetap di D1 tapi tersembunyi; form admin (`apps/web/src/components/admin/frame-form.tsx:73`) tetap textarea JSON, cukup prefill `DEFAULT_LAYOUT_V2` |
| 12 | `db/schema.ts` `vouchers` | tanpa kolom sumber | tambah `source` (`manual`, `auto-late-payment`, `auto-abandoned`, `staff-cancel`) dan `sessionId` asal; migrasi SQL tulis tangan `apps/api/migrations/0002_*.sql` (hanya `0001_init.sql` yang ada, tidak ada drizzle-kit), dijalankan `wrangler d1 migrations apply` |
| 13 | `routes/bridge.ts` (mount `/api/bridge`, `index.ts:42`; upload di `/api/session`, `index.ts:52`) | `POST /api/bridge/heartbeat` (skema `bridge.ts:115-120`), `GET /api/bridge/resolve`, `PUT /api/session/:id/photos` dan `/composite` | tambah `POST /api/bridge/session/:id/cancel-voucher`, `POST /api/bridge/session/:id/done`, `POST /api/bridge/session/:id/print-status` (disimpan di `sessions.metadata.print`, `schema.ts:96`, tanpa migrasi); `heartbeatBodySchema` tambah `counters: {paper, ink}` opsional; semua `/api/bridge/*` pakai bearer `booths.bridge_token` |
| 14 | `routes/kiosk.ts:23` `GET /api/kiosk/boot?boothId=` | publik; daftar frame aktif (`kiosk.ts:46-56`) tanpa `layoutJson` (`kiosk.ts:71-82`); `useMockBridge` (`kiosk.ts:58-59`) | tetap publik; frame ikut `layoutJson` dan hanya `version: 2` (tipe `KioskBootData` di `packages/shared/src/types/socket-events.ts:140-160` ditambah `layoutJson`); hapus `useMockBridge`; dipakai kiosk dan agent (layout + artwork, cache lokal); `agentUrl` tidak perlu karena kiosk satu origin |
| 15 | `do/booth.ts:362`, `:649-665`, `:832-880`, `:1081`; `index.ts:87` | `done` diset oleh event ws bridge `PRINT_COMPLETED`; `onPhotoUploaded` set `capturing/processing` dan `pushToBridge(BRIDGE_COMPOSITE)`; `onCompositeUploaded` `pushToBridge(BRIDGE_PRINT)`; route `/ws/bridge/:boothId` | hapus jalur ws bridge, `pushToBridge`, `dispatchBridge` (`:358`), dan `mock_bridge` (tipe `mock_*` di `AlarmTask`, `:987-1046`); `onPhotoUploaded` hanya insert baris `photos` (`:841`); `onCompositeUploaded` hanya simpan `r2Key`; keduanya tidak menyentuh `sessions.status` |
| 16 | `do/booth.ts` (RPC baru), `do/rpc.ts` | tidak ada | RPC `markDone(boothId, sessionId)` mengikuti pola `markPaid` di `rpc.ts:50`; dipanggil `POST /api/bridge/session/:id/done`; satu-satunya pengubah status ke `done`; diterima dari `capturing` dan `stale` (bagian 7) |
| 17 | `do/booth.ts:207`, `:545`, `:710`, `:879`; `routes/booths.ts:93-105` | `use_mock_bridge` default true kalau `metadata` booth kosong; `downloadToken` baru dikirim lewat `COMPOSITE_READY` setelah unggahan R2 | hapus `use_mock_bridge` (DO, `kiosk.ts`, `booths.ts`); `downloadToken` (sudah dibuat di `booth.ts:447` saat sesi lahir) ikut event `PAYMENT_PAID` (`booth.ts:710`) untuk jalur QRIS dan voucher; `COMPOSITE_READY` dihapus |
| 18 | `do/booth.ts:203-217` (`KIOSK_READY`); `packages/shared/src/constants/index.ts:39`; `routes/bridge.ts:203`, `:231` | `KIOSK_READY` bawa `bridgeOnline`, `useMockBridge`; `ALLOWED_IMAGE_MIME = ["image/png"]` sehingga unggahan JPEG ditolak `invalid_mime` (`lib/storage.ts:171`); kunci R2 dipaksa `photo-N.png` dan `composite.png` | `KIOSK_READY` bawa `activeSession: {id, status, expiresAt, downloadToken} \| null` (untuk pemulihan kiosk, bagian 5) dan buang dua field lama; kiosk buang `SET_BRIDGE_STATUS` (`kiosk-shell.tsx:117`, `state-machine.ts:75`); `ALLOWED_IMAGE_MIME` tambah `image/jpeg`; ekstensi kunci R2 ikut content-type (`.jpg` untuk JPEG); share page dan admin membaca `photos.r2Key` apa adanya, jadi tidak ada perubahan lain |

Status sesi baru dari bagian 7 dan 10 (`abandoned_paid`, `stale`, `cancelled`) ditambahkan ke union TypeScript dan zod di DO sebagai bagian dari perubahan #6. `sessions.status` di `db/schema.ts:84` berupa `text` bebas, jadi tidak ada enum DB dan tidak ada migrasi untuk ini. `forceReset` (`booth.ts:753`) dan `refundSession` tetap memakai status `failed` yang sudah ada.

Konstanta kiosk `packages/shared/src/constants/kiosk.ts`:

| Baris | Konstanta | Sekarang | Jadi |
|---|---|---|---|
| 3 | `IDLE_RESET_MS` | 5 menit | tetap |
| 4 | `PAYMENT_TIMEOUT_MS` | 5 menit | 60 detik, sama dengan `expires_at` |
| 5 | `GET_READY_MS` | 10 detik | tetap |
| 6 | `COUNTDOWN_PER_PHOTO_MS` | 8 detik | 5 detik; jendela tangkap tidak lagi ditambahkan ke sini |
| 12 | `CHEESE_HOLD_MS` | 1,2 detik | tidak dipakai, ganti event `shutter_fired` |
| 15 | `POST_CAPTURE_HOLD_MS` | 0,8 detik | tidak dipakai, diganti `REVIEW_SHOT` |
| 17 | `LIVE_PREVIEW_POLL_MS` | 150 ms (polling gambar) | hapus; preview memakai `<img src="/preview.mjpeg">` dari agent, tanpa polling |
| 18 | `PROCESSING_TIMEOUT_MS` | 30 detik | 20 detik untuk compose saja; cetak tidak lagi menunggu di layar ini |
| 19 | `PREVIEW_AUTO_ADVANCE_MS` | 5 detik | tetap, dipakai `REVIEW_SHOT` |
| 20 | `CONTACT_TIMEOUT_MS` | 60 detik | hapus |
| 21 | `DONE_AUTO_RESET_MS` | 8 detik | 60 detik (waktu scan QR) |
| 22 | `CAPTURE_WAIT_MS` | 60 detik | 15 detik, lewat itu `CALL_STAFF` |
| 23 | `PHOTO_COUNT` | 3 | 4 |
| 26-30 | `MOCK_BRIDGE` | blok timing mock bridge | hapus, tidak dipakai (perubahan #15) |
| baru | `PAID_START_TIMEOUT_MS` | tidak ada | 3 menit, `PEMBAYARAN_OK` → `IDLE`, sama dengan alarm DO |

Spesifikasi layout v2 untuk desainer frame:

| Item | Nilai |
|---|---|
| Kanvas | 1200 × 1800 px, 300 dpi, portrait, 4R (102 × 152 mm) |
| Bleed | artwork PNG 1200 × 1800, elemen penting di dalam 36 px dari tiap tepi (3 mm) |
| Area cetak nyata CP1500 | kertas postcard 100 × 148 mm; tepi ±12 px kiri-kanan dan ±24 px atas-bawah bisa terpotong; verifikasi di bagian 13 |
| Slot default (`DEFAULT_LAYOUT_V2`, dikunci owner 30 Sep 2026) | 2 kolom × 2 baris, tiap slot 525 × 350 px (rasio 3:2 sesuai sensor 2000D), margin kiri-kanan 60 px, gutter 30 px, blok slot mulai y = 120; koordinat slot 1..4: (60,120), (615,120), (60,500), (615,500); sisa 950 px di bawah (y ≥ 850) untuk artwork. Desainer boleh menggeser per frame lewat `layoutJson` |
| Field `layoutJson` | `version: 2, canvasWidth, canvasHeight, slots[4]{x,y,w,h}, artworkKey`; validasi: 4 slot, semua slot di dalam kanvas, tidak saling tumpang tindih, rasio `w:h` 3:2 dengan toleransi 2% |
| Cara compose (agent, `sharp`) | foto mentah 2000D di-`resize` cover ke `w×h` slot (crop tengah), ditempel di `(x,y)`, lalu artwork PNG (dengan lubang transparan di posisi slot) di-composite paling atas; output JPEG kualitas 92 |

---

## 9. booth-agent punya 13 endpoint HTTP, 9 event ws, 1 antrean, 2 penghitung

Stack: Node 22, `fastify` + `@fastify/websocket` + `@fastify/static` + `@fastify/http-proxy`, `sharp`, `better-sqlite3`, `execa`. Listen `127.0.0.1:7777`. Unit systemd `booth-agent.service`, `Restart=always`. Direktori data `/var/lib/booth-agent/` (SQLite `agent.db`, `sessions/<id>/raw-<slot>.jpg`, `composite.jpg`, `frames/<frameId>.png` cache).

Endpoint HTTP:

| Method | Path | Fungsi | Balasan |
|---|---|---|---|
| GET | `/`, `/assets/*`, dan path lain yang bukan `/api`, `/ws`, atau endpoint agent (mis. `/kiosk/<boothId>`) | sajikan build statis kiosk `apps/web/dist`; fallback ke `index.html` untuk route SPA | HTML/JS |
| ANY | `/api/*` dan `/ws/*` | reverse proxy ke `API_ORIGIN` (Workers) lewat `@fastify/http-proxy` dengan `websocket: true`; kiosk tetap memakai URL relatif | balasan Workers |
| GET | `/health` | status kamera, printer, antrean, penghitung, `activeSession` (`{id, nextSlot, retakeUsed[], phase}` atau `null`; dipakai pemulihan kiosk bagian 5 dan bagian 10 #12) | JSON |
| GET | `/preview.mjpeg` | stream MJPEG dari Brio (`/dev/v4l/by-id/...`), 640×480, 15 fps | multipart |
| GET | `/files/sessions/:id/:name` | `raw-<slot>.jpg` atau `composite.jpg` dari `/var/lib/booth-agent/sessions/<id>/`; dipakai `thumbUrl`, `compositeUrl`, dan thumbnail halaman staf; hanya nama file yang cocok pola itu | JPEG |
| POST | `/session/start` | `{sessionId, frameId}`; 409 `CAMERA_OFFLINE` kalau kamera tidak terdeteksi; ambil layout dan artwork dari `GET /api/kiosk/boot?boothId=` (publik) dan simpan di cache kalau belum ada; reset progres; sesi lokal ditulis ke SQLite (tabel `sessions_local`: `id, frameId, phase, nextSlot, retakeUsed, startedAt`) | `{ok}` |
| POST | `/session/:id/capture` | `{slot}` 1..4; single-flight; kalau kamera sedang dipakai balas 409 | `{accepted}` lalu event |
| POST | `/session/:id/retake` | `{slot}`; tolak 409 kalau slot itu sudah retake | `{accepted}` |
| POST | `/session/:id/compose` | dipanggil kiosk setelah review slot 4; susun 4 slot ke kanvas 1200×1800 sesuai `layoutJson`; simpan `composite.jpg`; pancarkan `compose.done`; antrekan `done`, upload, dan 2 job cetak | `{compositePath}` |
| POST | `/print` | `{sessionId, copies}` → `copies` job `lp` terpisah | `{jobIds[]}` |
| POST | `/print/reprint` | `{sessionId, sheet}` 1 job | `{jobId}` |
| POST | `/staff/login` | `{pin}` → token 10 menit; 5 salah → kunci 5 menit | `{token}` atau 401/423 |
| POST | `/staff/camera-reset`, `/staff/counters`, `/staff/cancel-voucher` | butuh header `x-staff-token` | JSON |

Event ws (`/agent/ws`, agent → kiosk, JSON `{type, ...}`; dipisah dari `/ws/*` supaya tidak bentrok dengan proxy):

| Event | Payload | Dipakai kiosk untuk |
|---|---|---|
| `camera.status` | `{connected, model, lastError}` | banner di `IDLE`, masuk `CALL_STAFF` |
| `shutter_fired` | `{sessionId, slot}` | kedip layar, akhir "TAHAN!" |
| `photo.ready` | `{sessionId, slot, thumbUrl, retakeUsed}` | pindah `REVIEW_SHOT` |
| `photo.failed` | `{sessionId, slot, error}` | `CALL_STAFF` |
| `compose.done` | `{sessionId, compositeUrl}` | pindah `DONE` |
| `compose.failed` | `{sessionId, error}` | `CALL_STAFF` |
| `print.status` | `{sessionId, sheet, state: queued/printing/done/failed, cupsJobId}` | banner `PRINT_FAILED` |
| `upload.status` | `{sessionId, kind: photo/composite, state, attempt}` | tidak ditampilkan ke pelanggan, tampil di staf |
| `counters.updated` | `{paper, ink, lowPaper, lowInk}` | peringatan di `DONE` dan `IDLE` |

Single-flight kamera: satu mutex proses. `capture` dan `retake` masuk antrean panjang 1; permintaan kedua saat mutex terkunci ditolak 409. Perintah `gphoto2`:

```
gphoto2 --capture-image-and-download --filename raw-<slot>.jpg --force-overwrite
```

Timeout 12 detik per spawn; lewat itu `kill`, `photo.failed`. `shutter_fired` dipancarkan saat stdout `gphoto2` memuat baris `New file is in location`; kalau baris itu tidak muncul dalam 6 detik, pancarkan saat proses selesai (uji di bagian 13 menentukan mana yang dipakai).

Cetak: `lp -d selphy -o PageSize=<postcard> -o <opsi borderless> -n 1 composite.jpg`, dipanggil 2× untuk 2 job terpisah supaya kegagalan lembar kedua tidak membatalkan lembar pertama. Nama opsi `PageSize` dan borderless diambil dari `lpoptions -p selphy -l` saat T1 (PPD Gutenprint memberi nama sendiri, jangan ditebak), lalu dikunci di env `LP_OPTIONS`. Status dipantau `lpstat -W not-completed -o selphy` tiap 2 detik.

Antrean (tabel `upload_queue` di SQLite; nama tetap walau isinya juga `done`):

| Kolom | Isi |
|---|---|
| `id`, `sessionId`, `kind` (`done`/`composite`/`photo`), `slot` | identitas |
| `path`, `bytes`, `sha256` | file lokal (kosong untuk `done`) |
| `state` (`pending`/`uploading`/`done`/`failed`), `attempt`, `nextAt`, `lastError` | progres |

Worker antrean: 1 job sekaligus, urutan per sesi `done` → `composite` → `photo` slot 1..4. `done` memanggil `POST /api/bridge/session/:id/done`; `composite` dan `photo` memanggil `PUT /api/session/:id/composite` dan `PUT /api/session/:id/photos?sortOrder=<slot>` (`routes/bridge.ts:189,218`, body mentah, header `content-type: image/jpeg`, bearer `booths.bridge_token`, tidak mengubah status sesi). Backoff 5 s → 30 s → 2 menit → 10 menit, maksimum 20 percobaan lalu `failed` dan tampil di halaman staf. Composite lebih dulu dari foto mentah karena share page butuh composite. Antrean dibaca ulang saat agent start, jadi job yang tertinggal saat booth dimatikan malam hari jalan lagi pagi berikutnya. File lokal dihapus 14 hari setelah `done` (`DOWNLOAD_LINK_EXPIRY_DAYS` 7 hari + 7 hari cadangan).

SQLite dibuka dengan `journal_mode = WAL`, `synchronous = FULL`. Saat `SIGTERM` (shutdown lewat tombol power, bagian 12) agent berhenti menerima permintaan, menunggu proses `gphoto2` atau `lp` yang sedang jalan maksimal 10 detik, `PRAGMA wal_checkpoint(TRUNCATE)`, lalu `db.close()`. Unit systemd memberi `TimeoutStopSec=20`.

Penghitung (tabel `counters`):

| Penghitung | Dikurangi saat | Isi ulang | Peringatan `low` |
|---|---|---|---|
| `paper` | `print.status = done` per lembar | staf: +18, +36, atau angka manual | ≤ 10 lembar (`[TARGET, validasi]`, ≈ 5 sesi) |
| `ink` | sama | staf: "ganti kartrid" = 36 | ≤ 10 |

Selphy tidak melaporkan sisa kertas dan tinta ke CUPS, jadi angka ini murni hitungan. Kertas habis beneran terdeteksi lewat `lpstat` printer `stopped` dengan alasan `media-empty`, dan itu masuk baris "printer berhenti" di bagian 10.

---

## 10. Ada 15 pemicu kegagalan, tiap baris punya layar, aksi staf, dan nasib uang

| # | Pemicu | Layar pelanggan | Aksi staf | Nasib uang |
|---|---|---|---|---|
| 1 | QRIS tidak dibayar dalam 60 detik | kembali `IDLE` | tidak ada | tidak ada transaksi |
| 2 | Webhook `PAID` datang setelah sesi `expired` | sudah di `IDLE`, pelanggan mungkin komplain ke kasir | admin buka daftar voucher `auto-late-payment`, barista serahkan kode | uang masuk, ditukar voucher 1 sesi |
| 3 | Kode voucher salah | pesan "kode tidak dikenal", sisa percobaan | tidak ada | tidak ada |
| 4 | Voucher diskon yang tidak menutup harga penuh | pesan "voucher tidak berlaku di booth" (400), kembali ke `VOUCHER_INPUT` | tidak ada | tidak ada, voucher tidak terpakai |
| 5 | Pelanggan bayar lalu tidak menekan "Mulai Foto" | alarm 3 menit → `IDLE` | admin lihat voucher `auto-abandoned` | voucher otomatis, tetap berlaku |
| 6 | DSLR gagal jepret (timeout 12 detik atau error) | `CALL_STAFF` | reset kamera dari halaman staf; berhasil → lanjut dari slot yang gagal | tidak ada, sesi lanjut |
| 7 | DSLR tetap gagal setelah 2× reset | `CALL_STAFF` | batalkan sesi + terbitkan voucher | voucher `staff-cancel` Rp30.000 |
| 8 | Compose gagal (artwork frame rusak, disk penuh) | `CALL_STAFF` | batalkan + voucher; admin cek frame | voucher `staff-cancel` |
| 9 | Printer `stopped` (kertas habis, macet, tinta habis) | `DONE` + banner `PRINT_FAILED` "cetakan bermasalah, panggil barista"; QR tetap tampil. Kalau pelanggan sudah menekan "Selesai" dan kiosk sudah `IDLE`, banner yang sama tampil di `IDLE` ("cetakan sesi terakhir bermasalah") sampai staf menutupnya dari halaman staf | isi kertas/tinta, `cupsenable selphy` (user `booth` ada di grup `lpadmin`, tanpa sudo), cetak ulang lembar yang gagal | tidak ada; kalau tidak bisa dicetak hari itu → refund `PRINT_FAILED` (tunai atau voucher) |
| 10 | Printer mati/USB lepas saat idle | banner di `IDLE` "printer tidak terdeteksi"; pelanggan tetap boleh mulai sesi (dapat foto lewat QR, cetak menyusul saat printer hidup karena job tetap di antrean CUPS) | cek kabel, nyalakan | tidak ada |
| 11 | Upload gagal (wifi putus) | tidak tampil; share page bilang "sedang diunggah" | halaman staf tampil antrean tertunda; agent coba ulang sampai 20× | tidak ada |
| 12 | Chromium crash | `kiosk.service` restart otomatis ≤ 5 detik; kiosk pulih sesuai aturan pemulihan bagian 5 (`localStorage` + `KIOSK_READY.activeSession` + `GET /health`) | tidak ada | tidak ada |
| 13 | `booth-agent` crash | kiosk tampil `CALL_STAFF` kalau ws `/agent/ws` putus > 10 detik; systemd restart 2 detik; kiosk reconnect lalu pulih seperti #12 | kalau sesi sedang capture: lanjut dari `nextSlot` yang tersimpan di `sessions_local` | tidak ada |
| 14 | Listrik padam saat sesi berjalan (atau tombol power ditekan saat sesi jalan) | booth mati | saat nyala lagi agent baca `sessions_local` dengan `phase ≠ finished`: kalau `composite.jpg` ada → antrekan `done` + upload + cetak; kalau belum → tandai lokal `abandoned`, tidak ada panggilan ke DO, alarm 10 menit DO yang menandai `stale` dan menerbitkan voucher | voucher otomatis |
| 15 | Pelanggan pergi di tengah tangkapan | alarm 10 menit → `stale`; agent menerima `409 SESSION_STALE` kalau `done` datang belakangan → sesi lokal ditandai `orphaned`, tidak dicetak | admin lihat voucher `auto-abandoned` | voucher otomatis |

Baris 15 memakai aturan `markDone` dari `stale` di bagian 7: DO yang memutuskan berdasarkan voucher sudah terpakai atau belum, agent tinggal mengikuti balasan (200 → cetak, 409 → jangan cetak).

Refund selalu manual (tunai di kasir atau voucher). Tidak ada panggilan refund ke Xendit, sesuai `booth.ts:791-828`. Refund pada sesi `done` hanya tercatat; status sesi tidak berubah dan link share tetap terbuka.

---

## 11. Keamanan dipegang 6 aturan, nol rahasia di repo

| Area | Aturan |
|---|---|
| PIN staf | 4 digit, nilai diset owner lewat `booth-agent set-pin` di mini PC (Tailscale SSH), tidak disimpan di repo; hash `argon2id` di SQLite agent, tanpa endpoint admin dan tanpa PIN di D1; 5 salah → kunci 5 menit (satu-satunya rem untuk 4 digit, tidak dilonggarkan); token staf 10 menit di memori agent; keypad PIN hanya di halaman staf, tidak pernah di alur pelanggan |
| Voucher `/redeem` | rate limit di BoothDO (bagian 8 #9); kode 8 karakter huruf besar + angka tanpa `0/O/1/I`; kode tidak pernah tampil di log |
| `booths.bridge_token` | bearer untuk semua `/api/bridge/*` (termasuk `/done`, `/print-status`, `/cancel-voucher`); disimpan di `/etc/booth-agent/env` (`chmod 600`, owner `booth`); rotasi dari admin sudah ada (`routes/booths.ts:90`, `generateBridgeToken()` saat PATCH booth), setelah rotasi env di mini PC diganti manual lalu `systemctl restart booth-agent` |
| Agent | listen `127.0.0.1` saja; tidak ada port ke LAN; akses jarak jauh hanya lewat Tailscale SSH |
| Chromium kiosk | `--kiosk --noerrdialogs --disable-translate --no-first-run`, tanpa akses ke URL selain `127.0.0.1:7777` (policy `URLAllowlist` di `/etc/chromium/policies/managed/kiosk.json`, `URLBlocklist: ["*"]`); domain API tidak perlu masuk daftar karena lewat proxy agent |
| Webhook Xendit | verifikasi `x-callback-token` sudah ada di `routes/webhook.ts`; tidak berubah |

Rahasia yang ada di mini PC: `bridge_token`, hash PIN, kredensial Tailscale. Tidak ada kunci Xendit, tidak ada kunci R2 di mini PC.

---

## 12. Debian 13 dipasang dalam 13 langkah, 3 unit systemd, booth dinyalakan dan dimatikan lewat tombol power tiap hari

Pasang Debian 13 minimal (netinst, tanpa desktop):

| # | Langkah | Catatan |
|---|---|---|
| 1 | Install Debian 13 netinst, hanya "standard system utilities" + SSH | user `booth`, sudo |
| 2 | `apt install cage chromium seatd libinput-tools` | kiosk Wayland tanpa display manager dan tanpa autologin: `kiosk.service` sendiri yang membuka sesi di tty1; `systemctl enable seatd`; `booth` masuk grup `video`, `input`, `render` |
| 3 | `apt install gphoto2 libgphoto2-6 v4l-utils` | tambah user `booth` ke grup `plugdev`, `video` |
| 4 | `apt install cups cups-client cups-filters` | user `booth` ke grup `lpadmin` |
| 5 | Gutenprint 5.3.6 | Debian 13 punya 5.3.4 tanpa CP1500; ambil source 5.3.6 (forky) lalu `dpkg-buildpackage`, atau compile dari tarball; verifikasi `lpinfo -m \| grep -i cp1500` |
| 6 | `lpadmin -p selphy -E -v usb://Canon/SELPHY%20CP1500 -m <ppd 5.3.6>` | `lpoptions -d selphy` |
| 7 | Node 22 dari nodesource, `corepack enable` (pnpm 9.12.0 sesuai `package.json`), `pnpm install --frozen-lockfile` di `/opt/mote-capture` | repo pakai pnpm workspace, bukan npm |
| 8 | `pnpm --filter web --filter booth-agent build` langsung di mini PC | agent menyajikan `apps/web/dist`; Ryzen 9 cukup untuk build, tidak perlu salin dari VPS |
| 9 | udev: rule `by-id` untuk Brio (`/dev/v4l/by-id/usb-046d_Brio_100-*`) dan kamera Canon (`idVendor 04a9`, `MODE 0660 GROUP plugdev`) | jangan andalkan `/dev/video0` |
| 10 | `apt install chrony tailscale`; `tailscale up --ssh` | jam benar wajib untuk `expires_at` dan TLS |
| 11 | Pasang 3 unit systemd (di bawah), `systemctl enable booth-agent kiosk agent-backup.timer`; `systemctl mask getty@tty1` | getty di tty1 bentrok dengan cage |
| 12 | Tombol power = matikan bersih: `/etc/systemd/logind.conf.d/booth.conf` berisi `HandlePowerKey=poweroff`, `HandlePowerKeyLongPress=poweroff`, `HandleLidSwitch=ignore`; `systemctl restart systemd-logind` | satu tekan tombol power → `poweroff.target` → `SIGTERM` ke agent (bagian 9) → mati |
| 13 | BIOS Beelink: "Restore on AC Power Loss" = Power On; "Wake on LAN" off; "Fast Boot" on; cek tombol power tidak diset "instant off" di BIOS (harus lewat OS/ACPI) | Power On dipilih supaya listrik padam siang hari pulih tanpa staf; malam hari PC sudah S5 hasil `poweroff`, jadi tidak ikut menyala sendiri kecuali colokan dicabut lalu ditancap lagi, dan itu justru yang diinginkan pagi hari |

Unit systemd:

| Unit | Isi ringkas |
|---|---|
| `booth-agent.service` | `User=booth`, `ExecStart=node /opt/mote-capture/apps/booth-agent/dist/main.js`, `EnvironmentFile=/etc/booth-agent/env` (isi `BRIDGE_TOKEN`, `API_ORIGIN`, `BOOTH_ID`, `LP_OPTIONS`), `Restart=always`, `RestartSec=2`, `KillSignal=SIGTERM`, `TimeoutStopSec=20`, `After=network-online.target cups.service`, `Wants=network-online.target` |
| `kiosk.service` | `After=booth-agent.service seatd.service`, `Conflicts=getty@tty1.service`, `User=booth`, `PAMName=login`, `TTYPath=/dev/tty1`, `StandardInput=tty`, `TTYReset=yes`, `TTYVHangup=yes`, `TTYVTDisallocate=yes`, `Environment=XDG_RUNTIME_DIR=/run/user/1000 XDG_SESSION_TYPE=wayland`, `ExecStartPre=/bin/sh -c 'until curl -sf http://127.0.0.1:7777/health; do sleep 1; done'`, `ExecStart=cage -s -- chromium --kiosk --ozone-platform=wayland --noerrdialogs --disable-translate --no-first-run http://127.0.0.1:7777/kiosk/<boothId>`, `Restart=always`, `RestartSec=3` |
| `agent-backup.timer` + `.service` | `OnBootSec=10min`, `Persistent=true`; `sqlite3 /var/lib/booth-agent/agent.db ".backup /var/backups/agent-$(date +%F).db"`, hapus yang lebih tua dari 14 hari. Dijalankan setelah boot karena booth mati di malam hari, timer `OnCalendar` malam tidak pernah bunyi |

Siklus listrik harian (SOP tim kedai, ditempel di booth):

| Saat | Langkah | Alasan |
|---|---|---|
| Buka | 1. nyalakan printer CP1500; 2. nyalakan kamera (saklar ON, dummy battery sudah tercolok); 3. tekan tombol power mini PC; 4. tunggu layar `IDLE` muncul (target ≤ 60 detik dari tekan, T12) | perangkat USB yang sudah hidup saat PC boot terdeteksi tanpa langkah tambahan |
| Buka, tapi lupa urutan (printer/kamera dinyalakan setelah PC) | tidak perlu restart apa pun: CUPS mengikat printer USB lewat udev saat dicolok/dinyalakan; agent memanggil `gphoto2 --auto-detect` tiap 10 detik selama kamera belum terdeteksi dan memancarkan `camera.status` begitu ketemu | T14 menguji keduanya |
| Tutup | 1. pastikan layar `IDLE` (tidak ada sesi jalan); 2. tekan tombol power mini PC SATU KALI, lepas; 3. tunggu layar gelap dan lampu mini PC mati; 4. matikan kamera dan printer | tekan satu kali = shutdown bersih; menahan tombol 4 detik atau mencabut colokan = mati paksa, SQLite dan CUPS bisa rusak |
| Dilarang | mencabut colokan listrik atau mematikan MCB/stop kontak selagi lampu mini PC masih nyala | sama seperti di atas |

Konsekuensi yang diterima owner: job upload yang belum selesai saat tutup kedai (wifi lambat sore hari, pelanggan terakhir) baru jalan pagi berikutnya saat booth dinyalakan; link share pelanggan terakhir bisa baru terbuka esok pagi. Share page sudah menampilkan "sedang diunggah" untuk kasus ini (bagian 5).

Deploy: `ssh booth@<tailscale-ip> 'cd /opt/mote-capture && git pull && pnpm install --frozen-lockfile && pnpm --filter web --filter booth-agent build && sudo systemctl restart booth-agent kiosk'`. Manual, tanpa jadwal, tanpa rollback otomatis. Kalau rusak, `git checkout <commit-lama>` lalu restart lagi.

Log dan cadangan:

| Item | Cara |
|---|---|
| Log agent | `journalctl -u booth-agent`, JSON per baris, rotasi journald 200 MB |
| Log CUPS | `/var/log/cups/error_log`, `LogLevel warn` |
| Cadangan SQLite agent | `agent-backup.timer` di atas, 10 menit setelah tiap boot, simpan 14 hari |
| Cadangan foto lokal | tidak ada; sumber kebenaran ada di R2 setelah upload `done` |
| Pantau dari jauh | Claude Code di mini PC lewat Tailscale SSH; `GET /health` lewat `curl` lokal |

---

## 13. Uji otomatis 7 hal di M1, 14 hal perangkat sebelum booth dipasang, 13 skenario alur sesudahnya

Uji otomatis M1 (vitest + `@cloudflare/vitest-pool-workers` di `apps/api`; belum ada satu pun uji, `apps/api/package.json` tanpa skrip `test`; alarm diuji dengan `runDurableObjectAlarm` dari `cloudflare:test`, bukan menunggu waktu nyata):

| # | Uji | Kriteria lulus |
|---|---|---|
| U1 | voucher menutup penuh vs voucher diskon | penuh → `markPaid` jalan; `finalAmount > 0` → 400 "voucher tidak berlaku di booth", `markPaid` tidak dipanggil |
| U2 | rate limit `/redeem` | percobaan ke-6 dalam satu sesi dan ke-31 per booth per 10 menit → 429 |
| U3 | webhook `PAID` setelah `expired` | voucher `auto-late-payment` terbit, balas 200 |
| U4 | alarm per tahap | `payment` 60 detik → `expired`; `paid` tanpa `capture:start` 3 menit → `abandoned_paid` + voucher; `capturing` 10 menit → `stale` + voucher; `session:create` saat `paid` → `BOOTH_BUSY` dengan `releasesAt` |
| U5 | `markDone` | status `done` hanya lewat `POST /api/bridge/session/:id/done`; unggahan foto/composite (JPEG) tidak mengubah status; `markDone` dari `stale` dengan voucher belum terpakai → `done` + voucher `disabled`; voucher sudah terpakai → 409 |
| U6 | share saat `done` tapi composite belum di R2 | 200 dengan `state: "uploading"` |
| U7 | refund sesi `done` | tercatat, status tetap `done`, share tetap 200 |

Uji perangkat (lulus semua dulu, baru pasang di kedai):

| # | Uji | Kriteria lulus |
|---|---|---|
| T1 | Gutenprint 5.3.6 cetak ke CP1500 di Debian 13 | `lp` 1 composite 1200×1800, hasil tanpa garis, warna wajar; catat waktu antrean → kertas keluar |
| T2 | 50× `gphoto2 --capture-image-and-download` berturut di 2000D, jeda 7 detik | 50/50 berhasil; catat p50 dan p95 waktu spawn → file tersimpan; tentukan sumber `shutter_fired` |
| T3 | Proxy agent meneruskan `fetch` dan upgrade ws `/ws/kiosk/<boothId>` ke Workers; Chromium kiosk hanya memanggil `127.0.0.1:7777` | semua panggilan lewat, tidak ada prompt Local Network Access, ws tetap hidup 12 jam |
| T4 | Kalibrasi framing Brio vs 2000D | overlay kotak di preview; objek di tepi kotak masuk di foto DSLR dengan selisih ≤ 5% lebar `[TARGET, validasi]` |
| T5 | Fokus manual 2000D terkunci pada jarak duduk pelanggan | 20 foto berturut tajam tanpa hunting |
| T6 | 2000D `imageformat` = small JPEG via `gphoto2 --set-config` | file ≤ 1,5 MB, transfer ≤ 2 detik |
| T7 | Jenis port USB 2000D | pastikan mini-B; kabel 1,5 m yang ada cocok |
| T8 | Sentuh PM161QT di bawah cage | tap, drag, tanpa offset; `libinput list-devices` menampilkan touch |
| T9 | udev by-id Brio dan Canon | cabut-colok 10×, path tetap, agent tidak perlu restart |
| T10 | chrony sinkron setelah PC semalaman mati | `chronyc tracking` offset < 100 ms dalam 2 menit setelah boot; QR Xendit pertama pagi hari tidak ditolak karena jam |
| T11 | Pengaturan 2000D untuk operasi 12 jam | kamera menolak jepret tanpa kartu SD, jadi kartu wajib terpasang (atau opsi "release shutter without card" aktif); auto power off mati; `capturetarget` diset eksplisit lewat `gphoto2 --set-config`; lensa di MF; SOP power-cycle kamera lewat dummy battery (cabut-pasang ACK-E10) kalau `usbreset` gagal, dicoba dan dicatat |
| T12 | Cold boot → kiosk | dari tekan tombol power sampai layar `IDLE` dengan `camera.status.connected = true` ≤ 60 detik `[TARGET, validasi]`; 10 kali berturut, catat p50 dan maksimum |
| T13 | Tombol power ditekan sekali saat: (a) `IDLE`, (b) antrean upload masih 3 job, (c) `lp` sedang mencetak lembar 2 | (a) mati ≤ 15 detik; (b) setelah boot ulang `sqlite3 agent.db "PRAGMA integrity_check"` = `ok`, 3 job masih `pending` dan selesai sendiri; (c) job CUPS masih ada di `lpstat -o` setelah boot dan keluar setelah printer nyala, atau `print.status = failed` yang tampil di halaman staf, tidak ada job hilang diam-diam |
| T14 | Urutan nyala perangkat | printer dan kamera dinyalakan sebelum PC → keduanya terdeteksi saat `IDLE` muncul; dinyalakan 2 menit setelah PC → kamera terdeteksi ≤ 15 detik lewat polling `gphoto2 --auto-detect`, printer kembali `idle` di `lpstat -p selphy` tanpa restart apa pun |

Uji alur (di booth, sebelum buka untuk pelanggan):

| # | Skenario | Kriteria lulus |
|---|---|---|
| A1 | Sesi normal QRIS, tanpa retake | 4 foto, composite, 2 lembar keluar, QR terbuka, durasi ≤ 2 menit 30 detik |
| A2 | Retake tiap foto 1× | tombol "Ulangi" hilang setelah dipakai; slot tertimpa; durasi ≤ 3 menit 30 detik |
| A3 | QRIS dibiarkan 60 detik | kiosk ke `IDLE`; QR Xendit sudah kedaluwarsa; tidak ada sesi nyangkut di DO |
| A4 | Bayar QRIS pada detik ke-58 | sesi lanjut normal |
| A5 | Simulasi webhook telat (mock pay `routes/session-admin.ts` `devMockPayRoutes` setelah expired) | voucher `auto-late-payment` muncul di admin |
| A6 | Voucher penuh, voucher diskon, kode salah 5× | voucher penuh diterima; voucher diskon ditolak "voucher tidak berlaku di booth"; kode salah sesuai bagian 10 #3 |
| A7 | Cabut USB kamera saat foto ke-3 | `CALL_STAFF`; reset kamera; lanjut dari foto ke-3 |
| A8 | Cabut USB kamera, tidak dicolok lagi | staf batalkan; voucher `staff-cancel` tampil di admin |
| A9 | Kertas habis saat lembar ke-2 | lembar 1 keluar; banner `PRINT_FAILED`; staf isi kertas; cetak ulang lembar 2 |
| A10 | Matikan wifi setelah composite | pelanggan tetap dapat QR; share page "sedang diunggah"; wifi nyala → foto muncul ≤ 1 menit |
| A11 | Bayar, tidak menekan "Mulai Foto" | 3 menit → `IDLE`, booth bebas; voucher `auto-abandoned` tetap berlaku |
| A12 | Cabut listrik saat `processing`, nyalakan lagi (satu-satunya uji yang sengaja mati paksa) | agent pulih; composite ada → `done` + cetak + upload jalan; tidak ada → alarm DO menerbitkan voucher |
| A13 | Refund sesi `done` dari admin | status tetap `done`; link share masih terbuka |

---

## 14. Kerja dibagi 5 tahap, M1 sampai M3 mulai sekarang di VPS pakai mock, M4 dimulai hari perangkat tiba

| Tahap | Isi | Selesai kalau | Owner |
|---|---|---|---|
| M1. Cloud fix | 18 perubahan di bagian 8; migrasi SQL tulis tangan `0002_*.sql` (`vouchers.source`, `vouchers.sessionId`) dengan `wrangler d1 migrations apply`; layout v2 (skema `version: 2`, `DEFAULT_LAYOUT_V2`); alarm DO; share `uploading`; `ALLOWED_IMAGE_MIME` + JPEG; tambah vitest + `@cloudflare/vitest-pool-workers` ke `apps/api` | U1 sampai U7 (bagian 13) lulus; A3, A5, A6, A11 tercakup U1-U4 | Nanan + Claude Code |
| M2. Kiosk UI | state baru bagian 7, tombol "Mulai Foto", layar `REVIEW_SHOT`, `CALL_STAFF`, `STAFF`, halaman staf (PIN 4 digit), peringatan kertas, pemulihan `localStorage` (bagian 5); build statis; spec Playwright kiosk baru di `apps/web/e2e` (sekarang hanya `admin.spec.ts` dan `share.spec.ts`) | spec Playwright kiosk lulus tanpa agent: endpoint agent di-stub `page.route`, ws `/agent/ws` di-stub `page.routeWebSocket` (Playwright 1.62 di `apps/web/package.json:35`), DO lewat `wrangler dev`; skenario minimal: alur normal, retake, `CALL_STAFF` saat `photo.failed`, PIN salah 5× terkunci, pemulihan setelah reload di `REVIEW_SHOT` | Nanan + Claude Code |
| M3. booth-agent | package baru `apps/booth-agent` (sudah tercakup glob `apps/*` di `pnpm-workspace.yaml`; tambah `tsconfig.json` yang extends `tsconfig.base.json` dan skrip `build`/`dev`/`type-check` supaya `turbo.json` mengenalinya); semua endpoint dan event bagian 9; mock: `MOCK_CAMERA=1` mengembalikan JPEG contoh dari `apps/booth-agent/fixtures` dengan jeda 1,5 detik dan memancarkan `shutter_fired`, `MOCK_PRINTER=1` menulis ke `/tmp` dan lapor `done` setelah 3 detik, `MOCK_PREVIEW=1` mengulang MJPEG dari fixture; dev: kiosk lewat agent `:7777` yang mem-proxy ke `wrangler dev` `:8787`, proxy vite (`apps/web/vite.config.ts:16-27`, ke `:8787`) tetap untuk admin | alur A1, A2, A7 (dengan `MOCK_CAMERA_FAIL_AT=3`), A11 lulus end-to-end di VPS tanpa perangkat; `SIGTERM` saat antrean berisi → job tetap `pending` setelah start ulang | Nanan + Claude Code |
| M4. Booth di rumah | mulai hari EQR6 + 2000D + CP1500 tiba; Debian 13 di EQR6, T1 sampai T14 | 14 uji perangkat lulus; L355 dipakai hanya sampai CP1500 tersambung | Nanan |
| M5. Booth di kedai | pasang, A1 sampai A13, SOP siklus listrik ditempel, 3 hari uji dengan pelanggan nyata | metrik bagian 1 terpenuhi 3 hari berturut; tim kedai menjalankan buka-tutup 3 hari tanpa instruksi lisan | Nanan + barista |

Tidak ada tanggal kalender. M1 sampai M3 boleh jalan paralel (M2 dan M3 sama-sama bergantung pada kontrak event bagian 9, bukan satu sama lain). M4 dan M5 berurutan, dan M4 hanya bergantung pada kedatangan perangkat.

---

## 15. Tujuh hal belum terverifikasi, semuanya soal detail teknis

| # | Hal | Dampak kalau salah | Cara tutup |
|---|---|---|---|
| 1 | Baris stdout `gphoto2` yang bisa dipakai sebagai `shutter_fired` (versi libgphoto2 di Debian 13 vs 2000D) | kedip layar telat, pelanggan bergerak sebelum jepret | T2 |
| 2 | Area cetak nyata CP1500 lewat Gutenprint 5.3.6 untuk kertas postcard 100 × 148 mm dari kanvas 1200 × 1800, dan nama opsi `PageSize`/borderless di PPD-nya | artwork terpotong lebih dari 36 px; `lp` menolak opsi | T1, `lpoptions -p selphy -l`, ukur cetakan dengan penggaris |
| 3 | Apakah CP1500 lebih stabil dicolok langsung ke mini PC daripada lewat hub M-Tech (dye-sub menarik arus saat cetak) | job cetak putus di tengah | T1 diulang lewat hub dan langsung |
| 4 | Proxy agent meneruskan upgrade websocket ke Workers/DO stabil selama 14 jam (reconnect, hibernasi DO) | kiosk kehilangan event pembayaran | T3 |
| 5 | Memori Chromium + cage setelah 14 jam menampilkan MJPEG (satu hari operasi, karena booth dimatikan tiap malam) | kiosk melambat sore hari | T3, pantau `free -m` per jam; kalau naik terus, `kiosk.service` diberi `MemoryMax=4G` supaya systemd yang merestart, bukan timer |
| 6 | Xendit menutup QR pada `expires_at` 60 detik tepat, atau ada toleransi settle setelah itu | frekuensi kasus #2 di bagian 10 | A4, A5, plus tanya Xendit support |
| 7 | Tombol power Beelink EQR6 memicu ACPI ke logind (bukan hard-off di firmware), dan opsi "Restore on AC Power Loss" ada di BIOS-nya | shutdown tidak bersih; booth tidak menyala lagi setelah listrik padam siang | T13, cek menu BIOS saat langkah 13 bagian 12 |

Yang tidak dibuka lagi: pilihan perangkat, Debian 13, tanpa Electron, tanpa offline, tanpa WhatsApp, 1 menit QRIS, 4 foto, retake 1× per foto, 2 lembar per sesi, PIN 4 digit, tanpa timer restart malam, layout default 2×2.
