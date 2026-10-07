# Konteks booth mote-capture di mini PC (diperbarui 30 Sep 2026, mengikuti PRD draft 3)

Dokumen ini merangkum latar, aturan owner, dan keputusan yang sudah dikunci. Spesifikasi teknis lengkap ada di [`prd-booth-minipc.md`](./prd-booth-minipc.md). Bentrok antara dua file ini → PRD yang menang untuk detail teknis, file ini yang menang untuk aturan owner.

## Latar

- Booth foto untuk kedai kopi milik Nanan sendiri. Satu booth, 30 pelanggan/hari, Rp30.000/sesi, nyala lebih dari 12 jam/hari, layar sentuh saja.
- Versi lama jalan di Electron + `apps/bridge` (Windows). Dibangun ulang karena Electron boros RAM.
- Sisi cloud (`apps/api` Cloudflare Workers + Durable Object, admin di `apps/web`) dipakai lagi dan diperbaiki. Yang baru hanya `booth-agent` di mini PC.

## Aturan owner (jangan dilanggar, jangan dibahas ulang)

| Aturan | Kata Nanan / alasan |
|---|---|
| Tanpa Electron, tanpa `apps/bridge` | "berat dan memakan banyak resource ram saya... ingat itu" |
| Cloud = Cloudflare saja | VPS tidak menjalankan apa pun di produksi, cuma tempat coding |
| Gaya UI kiosk mote-capture dipertahankan | |
| Hardware sudah dikunci | "jangan ganggu hardware list yang sudah ada" |
| Kabin dan LED panel tidak dibahas | dibeli dan diurus Nanan sendiri |
| Tanpa mode offline | wifi dianggap hidup selama listrik hidup |
| Jangan ungkit isi keranjang belanja | fokus ke topik yang dibahas |
| Kode dari PhotoboothProject/photobooth (MIT) boleh dipinjam | cuma pola, stack-nya PHP |
| PRD ditulis Fable | permintaan Nanan |

## Hardware (terkunci)

| Komponen | Peran |
|---|---|
| Beelink EQR6 (Ryzen 9 6900HX, 24 GB / 512 GB) | host kiosk + `booth-agent` + CUPS, Claude Code untuk operasi jarak jauh |
| Canon EOS 2000D + kit 18-55 III + ACK-E10 | foto final via `gphoto2` |
| Logitech Brio 100 | live preview saja |
| Acer PM161QT | layar sentuh (PM161Q versi tanpa touch) |
| M-Tech powered hub 7 port | colokan USB |
| Canon Selphy CP1500 | printer 4R; Epson L355 cuma untuk tes |

Tidak dipakai: Sony ZV-E10 (milik pribadi), UPS, router khusus.

## Keputusan yang dikunci

| Area | Keputusan |
|---|---|
| OS | Debian 13 minimal. Ubuntu ditolak karena Chromium wajib snap |
| Driver printer | Gutenprint 5.3.6 dikompilasi sendiri. Versi 5.3.4 di Debian 13 dan Ubuntu 24.04 tidak mengenal CP1500 (dicek di source `print-dyesub.c`) |
| Kiosk | Chromium + cage, UI `apps/web` disajikan dari mini PC (`127.0.0.1:7777`); `booth-agent` mem-proxy `/api/*` dan `/ws/*` ke Cloudflare Workers, kode kiosk tetap URL relatif |
| Pembayaran | QRIS Xendit, countdown 1 menit, habis → kembali ke menu awal |
| Voucher | kode dibuat di admin, kasir cuma pegang kode tercetak tanpa login, admin lihat terpakai/belum |
| Frame | 4 per halaman, prev/next, tanpa batas, aktif/nonaktif dari admin, tanpa filter |
| Sesi | 4 foto, countdown 5 detik, review 5 detik, retake maksimal 1× per foto |
| Cetak | 2 lembar 4R desain sama, 2 job terpisah, cetak ulang per lembar dari halaman staf |
| Selesai | sesi `done` saat composite tersimpan di mini PC; cetak dan upload jalan di belakang dengan layar tunggu lama ("Lagi nyiapin hasil cetakmu...") |
| Share | QR ke link foto, tanpa WhatsApp |
| Kertas/tinta | peringatan di layar kiosk berdasarkan hitungan, Selphy tidak melaporkan level |
| DSLR gagal | layar "panggil barista", reset dari halaman staf, lanjut dari foto yang gagal; tidak pulih → batal + voucher; tanpa fallback webcam |
| Deploy | manual `git pull` + restart lewat Tailscale, tanpa auto-update malam |
| Halaman staf | pojok kiri atas 5× atau tombol "Barista" di `CALL_STAFF`; PIN 4 digit, nilai diset owner lewat `booth-agent set-pin`, tidak disimpan di repo; salah 5× kunci 5 menit |
| Listrik harian | tidak ada timer restart malam. Pagi: printer dan kamera dulu, lalu tombol power mini PC. Malam: tekan tombol power sekali (shutdown bersih lewat logind), baru matikan kamera dan printer. Dilarang cabut colokan. Upload yang belum selesai jalan pagi berikutnya, link pelanggan terakhir bisa baru terbuka esok pagi |
| Layout default | 2×2 slot 525×350 px, margin 60, gutter 30, mulai y = 120; angka final, desainer boleh geser per frame |
| Jadwal | M1 sampai M3 mulai sekarang di VPS pakai mock; M4 mulai hari EQR6 + 2000D + CP1500 tiba (dibeli bersamaan); tanpa tanggal kalender |

## Keputusan owner 30 Sep 2026 atas usulan Fable

Putaran 1:

1. Setelah bayar, kiosk tampil tombol "Mulai Foto"; foto baru mulai saat ditekan. Tidak ditekan 3 menit → sesi `abandoned_paid`, kiosk ke `IDLE`, voucher otomatis Rp30.000 tetap berlaku.
2. Webhook bayar telat setelah QR kedaluwarsa → voucher `auto-late-payment`.
3. Voucher diskon tidak punya QR sisa. Booth hanya menerima voucher yang menutup harga penuh; `/redeem` balas 400 "voucher tidak berlaku di booth" dan tidak memanggil `markPaid`.
4. Rate limit voucher: 5×/sesi, 30×/booth per 10 menit.

Putaran 2 (menutup semua `[PENDING OWNER]` dan `[BUTUH DATA]` di PRD):

5. PIN staf 4 digit, nilai dipegang owner, tidak ditulis di repo. Lockout 5 salah → 5 menit tetap.
6. Timer restart malam dihapus. Booth dimatikan tiap tutup lewat tombol power, dinyalakan tiap buka. Ada cek BIOS dan 3 uji tambahan (T12 sampai T14 di PRD).
7. Angka slot layout default diterima apa adanya.
8. M1 sampai M3 langsung jalan dengan mock; M4 dan M5 menunggu perangkat tiba.

Tidak ada lagi keputusan yang menunggu owner.

## Bug kode lama yang sudah diverifikasi (commit `a45d307`)

| Lokasi | Masalah |
|---|---|
| `apps/api/src/do/booth.ts:405-413` | sesi baru ditolak selama sesi lama `paid/capturing/processing` → booth terkunci kalau pelanggan pergi |
| `apps/api/src/do/booth.ts:696-706` | webhook bayar setelah `expired` diabaikan → uang masuk tanpa sesi |
| `apps/api/src/do/booth.ts:791-828` | refund cuma catatan, tanpa panggilan Xendit |
| `apps/api/src/routes/voucher.ts:462-470` | voucher diskon tetap menandai lunas walau masih ada sisa bayar |
| `apps/api/src/routes/voucher.ts` `/redeem` | tanpa rate limit |
| `apps/api/src/routes/share.ts:64-66` | balas 425 sampai sesi `done` |
| `apps/api/src/lib/validations/frame.ts:28-41` | layout lama 1800×1200 6 slot, tidak cocok untuk 4R 4 slot |
| `packages/shared/src/constants/kiosk.ts` | timeout lama (bayar 5 menit, countdown 8 detik, proses 30 detik) |
| `packages/shared/src/constants/index.ts:39` | `ALLOWED_IMAGE_MIME = ["image/png"]`, unggahan JPEG dari agent bakal ditolak `invalid_mime` |
| `apps/api/src/routes/kiosk.ts:71-82` | payload boot kiosk tidak membawa `layoutJson`, agent tidak bisa compose tanpa itu |
| `apps/api/src/do/booth.ts:347`, `:533-590` | `capture:start` sudah lewat ws (`SocketEvents.START_CAPTURE`), tidak butuh route HTTP baru; yang dibuang cuma `photoIndex` per foto |

Tidak ada penghitung kertas/tinta di kode lama. Penggabung foto cuma ada di `apps/bridge/src/main/image/composer.ts` (dipakai sebagai referensi, bukan dijalankan). Rotasi `bridge_token` dari admin sudah ada (`routes/booths.ts:90`).

## Belum terverifikasi

- Port USB 2000D (mini-B atau bukan), touch PM161QT di bawah cage, framing Brio vs 2000D.
- Waktu jepret `gphoto2` di 2000D (uji 50×).
- Proxy agent untuk upgrade websocket ke Workers stabil 14 jam (T3).
- Area cetak nyata CP1500 lewat Gutenprint 5.3.6, plus nama opsi `PageSize`/borderless di PPD-nya.
- Tombol power Beelink EQR6 masuk ke logind (bukan hard-off firmware), opsi "Restore on AC Power Loss" ada di BIOS (T13).

Daftar uji lengkap: PRD bagian 13 dan 15.

## Referensi

- PRD: [`prd-booth-minipc.md`](./prd-booth-minipc.md)
- PhotoboothProject/photobooth (MIT), commit `00726f1`
- Memory Claude: `~/.claude/memory/mote-capture--minipc-linux-plan.md`
