# Panduan Admin: Booth, Frame & Harga, Settings

Untuk admin Capture (`capture.motekreatif.com/admin`). Urutan kerja: **booth dulu, baru frame**.

## 1. Pasang akun pembayaran (sekali per akun)

1. Buka **Settings**, lalu buka bagian **Pembayaran QRIS**.
2. Klik **Tambah akun**. Pilih Xendit atau iPaymu, lalu isi kunci dari dashboard provider.
   - Xendit: Secret Key (bukan Public Key) dan Webhook Token.
   - iPaymu: VA dan API Key.
3. Klik **Tes koneksi** sampai status **Terhubung**.

Satu akun boleh dipakai beberapa booth.

## 2. Buat booth

1. Menu **Booth**, lalu **Tambah booth**.
2. Isi nama, lokasi, dan **Harga default frame baru**. Harga ini hanya isian awal saat memasang frame, bukan harga final.
3. Klik **Save**. Halaman langsung pindah ke tab **Frame & Harga** booth itu.

## 3. Pasang frame & harga (per booth)

Di tab **Frame & Harga**:

- **Unggah frame baru**: unggah desain. Frame otomatis terpasang di booth ini dengan harga yang diisi.
- **Ambil dari library**: pakai desain yang sudah ada (misalnya dari booth lain), lalu isi harganya khusus booth ini.
- **Harga**: ketik angka, lalu tekan Enter atau klik di luar kolom. Harga hanya berlaku di booth ini. Booth lain tidak ikut berubah.
- **Tampil di kiosk**: matikan untuk menyembunyikan frame di booth ini saja.
- **Bintang (Utama)**: frame yang dipilih otomatis di kiosk. Hanya satu per booth.
- **Panah atas/bawah**: urutan tampil di kiosk.
- **Lepas**: mencabut frame dari booth ini. Desainnya tetap ada di library.

Label kuning di bawah nama frame menjelaskan kenapa frame tidak tampil, misalnya "Layout lama, edit desain dulu" atau "Belum masuk jadwal tampil".

## 4. Pilih akun pembayaran booth

Tab **Info & Pembayaran**, lalu pilih akun di **Akun pembayaran**, lalu **Save**. Berlaku mulai sesi berikutnya. Booth tanpa akun hanya bisa memakai voucher.

## 5. Library Frame

Menu **Library Frame** berisi semua desain. Kolom **Dipakai di** menunjukkan booth dan harga masing-masing. Frame yang masih terpasang di booth tidak bisa dihapus; lepas dulu dari booth, atau arsipkan.

## 6. WhatsApp & Umum

**Settings**, lalu bagian **WhatsApp** (pengiriman link foto) atau **Umum & Email**. Kolom kunci yang dikosongkan berarti tidak diubah.

Menu lama **Payments** dan **WhatsApp** otomatis diarahkan ke Settings.
