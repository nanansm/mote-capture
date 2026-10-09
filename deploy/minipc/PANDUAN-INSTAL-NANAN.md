# Panduan instal Debian 13 di HP EliteDesk 800 G6 (non-teknis)

Tugas Nanan: bagian A–E (sekitar 45 menit). Sisanya (aplikasi booth, printer, kamera, kiosk) dikerjakan dari jauh lewat Tailscale.

## Siapkan
- Flashdisk minimal 4 GB. Isinya akan terhapus.
- Kabel LAN ke router. Lebih aman daripada Wi-Fi saat instal.
- Monitor + kabel DisplayPort (atau adaptor DP ke HDMI), keyboard + mouse USB.
- Laptop untuk membuat flashdisk instalasi.

## A. Buat flashdisk instalasi (di laptop)
1. Unduh Debian 13: https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/ dan pilih berkas `debian-13.x.x-amd64-netinst.iso`.
2. Unduh dan buka balenaEtcher (https://etcher.balena.io).
3. Pilih Flash from file (ISO tadi), lalu Select target (flashdisk), lalu Flash. Tunggu sampai muncul "Flash Complete".

## B. Setel BIOS mini PC
1. Colok flashdisk, LAN, monitor, keyboard, dan mouse. Nyalakan PC sambil tekan **F10** berulang-ulang sampai masuk BIOS.
2. Advanced, lalu Power Management Options, lalu **After Power Loss = Power On**. Supaya PC menyala sendiri setelah listrik padam.
3. Secure Boot biarkan menyala. Debian 13 mendukungnya.
4. Simpan dengan **F10**, pilih Yes. PC restart.
5. Saat restart, tekan **F9** berulang-ulang, lalu pilih flashdisk (biasanya bertuliskan "USB" atau merek flashdisk).

## C. Instal Debian (ikuti persis)
1. Pilih **Graphical install**.
2. Language: **English**. Location: other, lalu Asia, lalu **Indonesia**. Locale: **en_US.UTF-8**. Keyboard: **American English**.
3. Hostname: `booth-01`. Domain name: kosongkan.
4. Root password: **KOSONGKAN dua-duanya**, langsung Continue. Akun yang dibuat berikutnya otomatis jadi admin.
5. Full name: `Mote Booth`. Username: `mote`. Password: buat sandi kuat, simpan di password manager. Jangan kirim lewat chat.
6. Partitioning: **Guided - use entire disk**, lalu pilih SSD 256 GB, lalu **All files in one partition**, lalu Finish partitioning, lalu **Yes**. Seluruh isi SSD terhapus.
7. Mirror: Indonesia, lalu `deb.debian.org`. HTTP proxy: kosongkan.
8. Popularity contest: No.
9. Software selection (penting):
   - HAPUS centang "Debian desktop environment" dan "GNOME".
   - CENTANG hanya **SSH server** dan **standard system utilities**.
10. Install GRUB: **Yes**, pilih SSD (bukan flashdisk).
11. Muncul "Installation complete": cabut flashdisk, lalu Continue.

## D. Pasang remote (Tailscale)
Setelah restart, layar hitam bertuliskan `booth-01 login:` itu normal.
1. Ketik `mote`, Enter, lalu ketik sandi. Huruf sandi memang tidak terlihat. Enter.
2. Ketik baris ini satu per satu, Enter tiap baris, masukkan sandi bila diminta:
```
sudo apt update
sudo apt install -y curl
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --hostname=booth-01 --qr
```
3. Muncul QR besar di layar. Scan dengan HP, login Tailscale pakai akun Google Mote, lalu klik **Connect**. Akun ini juga akun Tailscale untuk semua booth nanti.
4. Ketik `tailscale ip -4`. Foto angka yang muncul (diawali `100.`) dan kirim ke saya.

## E. Selesai dari sisi Nanan
Kabari "Tailscale sudah connect". Sisanya saya kerjakan dari jauh. Satu-satunya yang butuh tangan Nanan nanti hanya PIN staf 4 digit, diketik sendiri di mini PC.

## Kalau macet
- F9 tidak memunculkan flashdisk: ulangi bagian A, atau colok di port USB lain.
- Instalasi minta "firmware" atau tidak dapat internet: pastikan kabel LAN tercolok, lalu Go Back dan ulangi langkah jaringan.
- Lupa sandi `mote`: instal ulang dari bagian C. Sekitar 20 menit.
- Foto layar yang error, kirim ke saya.
