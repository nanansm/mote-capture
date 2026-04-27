export type Lang = "id" | "en";

const id = {
  "common.back": "Kembali",
  "common.cancel": "Batal",
  "common.skip": "Lewati",
  "common.send": "Kirim",
  "common.continue": "Lanjut",
  "common.start": "MULAI",
  "common.bahasa": "Bahasa",

  "kiosk.idle.tagline": "Foto kamu, frame estetik",
  "kiosk.idle.subtitle": "Cetak langsung + soft file",
  "kiosk.idle.start_button": "MULAI",
  "kiosk.idle.from_price": "Mulai dari Rp {price}",
  "kiosk.idle.tap_anywhere": "Tap untuk Mulai",

  "kiosk.frame.title": "PILIH FRAME",
  "kiosk.frame.regular": "REGULAR",
  "kiosk.frame.premium": "PREMIUM",
  "kiosk.frame.empty": "Belum ada frame aktif untuk booth ini.",

  "kiosk.confirm.title": "KONFIRMASI",
  "kiosk.confirm.total": "Total",
  "kiosk.confirm.pay_now": "BAYAR SEKARANG",

  "kiosk.payment.method.title": "Pilih Metode Pembayaran",
  "kiosk.payment.method.cashless": "Cashless",
  "kiosk.payment.method.voucher": "Voucher",

  "kiosk.voucher.header": "VOUCHER",
  "kiosk.voucher.title": "Masukkan Kode/Scan Voucher",
  "kiosk.voucher.subtitle": "Tanyakan kode ke operator atau cek email/WhatsApp kamu.",
  "kiosk.voucher.placeholder": "Kode Voucher",
  "kiosk.voucher.submit": "GUNAKAN VOUCHER",
  "kiosk.voucher.validating": "MEMVALIDASI...",
  "kiosk.voucher.success": "Voucher berhasil! Lanjut ke foto...",
  "kiosk.voucher.invalid": "Voucher tidak valid",
  "kiosk.voucher.error": "Gangguan jaringan, coba lagi.",
  "kiosk.voucher.no_session": "Tunggu sebentar, sesi sedang disiapkan.",
  "kiosk.voucher.preparing": "Menyiapkan sesi, mohon tunggu...",
  "kiosk.voucher.empty": "Masukkan kode voucher",
  "kiosk.voucher.back": "Kembali",
  "kiosk.voucher.clear": "Hapus Semua",
  "kiosk.voucher.backspace": "Hapus",

  "kiosk.payment.title": "BAYAR QRIS",
  "kiosk.payment.scan": "Scan QR di atas pakai e-wallet kamu",
  "kiosk.payment.providers": "GoPay, OVO, DANA, ShopeePay, BCA, semua aman",
  "kiosk.payment.waiting": "Menunggu pembayaran...",
  "kiosk.payment.expires_in": "QR berlaku {time}",
  "kiosk.payment.expired": "QR sudah kadaluarsa, silakan ulangi.",
  "kiosk.payment.mock": "Mode mock — Xendit belum dikonfigurasi.",

  "kiosk.paid.title": "Pembayaran Berhasil! ✨",
  "kiosk.paid.subtitle": "Siapkan posemu, akan ada 3 foto.",
  "kiosk.paid.start_capture": "MULAI FOTO",

  "kiosk.countdown.step": "Foto {n} dari 3",
  "kiosk.countdown.smile": "Senyum yang lebar! 😊",
  "kiosk.countdown.cheese": "Cheese!",
  "kiosk.countdown.get_ready": "GET READY!",

  "kiosk.processing.title": "Lagi nyiapin hasil cetakmu...",
  "kiosk.processing.subtitle": "Sebentar ya 🌿",

  "kiosk.preview.title": "HASILMU SIAP! 🎉",
  "kiosk.preview.printing": "Sedang dicetak... Ambil di slot bawah",

  "kiosk.contact.title": "Mau dapat soft file?",
  "kiosk.contact.subtitle": "Kami kirim ke WhatsApp dan Email kamu.",
  "kiosk.contact.phone": "Nomor WhatsApp (08xxxxxxxxxx)",
  "kiosk.contact.email": "Email (opsional)",
  "kiosk.contact.send": "KIRIM",
  "kiosk.contact.skip": "Lewati",
  "kiosk.contact.invalid_phone": "Nomor WhatsApp tidak valid",

  "kiosk.done.title": "Terima Kasih! 💚",
  "kiosk.done.printed": "Foto sudah dicetak.",
  "kiosk.done.softfile": "Soft file akan terkirim ke WhatsApp & Email kamu.",
  "kiosk.done.tag": "Tag kami di IG: @majakoffie",
  "kiosk.done.return": "Kembali ke awal dalam {n} detik...",

  "kiosk.error.unknown": "Ada error. Hubungi operator booth ya.",
  "kiosk.cancel.confirm": "Yakin batal? Pembayaran akan dibatalkan.",
};

const en: typeof id = {
  "common.back": "Back",
  "common.cancel": "Cancel",
  "common.skip": "Skip",
  "common.send": "Send",
  "common.continue": "Continue",
  "common.start": "START",
  "common.bahasa": "Language",

  "kiosk.idle.tagline": "Your photos, aesthetic frames",
  "kiosk.idle.subtitle": "Instant print + soft file",
  "kiosk.idle.start_button": "START",
  "kiosk.idle.from_price": "Starting from Rp {price}",
  "kiosk.idle.tap_anywhere": "Tap to Start",

  "kiosk.frame.title": "PICK A FRAME",
  "kiosk.frame.regular": "REGULAR",
  "kiosk.frame.premium": "PREMIUM",
  "kiosk.frame.empty": "No active frames for this booth yet.",

  "kiosk.confirm.title": "CONFIRM",
  "kiosk.confirm.total": "Total",
  "kiosk.confirm.pay_now": "PAY NOW",

  "kiosk.payment.method.title": "Choose Payment Method",
  "kiosk.payment.method.cashless": "Cashless",
  "kiosk.payment.method.voucher": "Voucher",

  "kiosk.voucher.header": "VOUCHER",
  "kiosk.voucher.title": "Enter / Scan Voucher Code",
  "kiosk.voucher.subtitle": "Ask the operator or check your email/WhatsApp.",
  "kiosk.voucher.placeholder": "Voucher Code",
  "kiosk.voucher.submit": "USE VOUCHER",
  "kiosk.voucher.validating": "VALIDATING...",
  "kiosk.voucher.success": "Voucher accepted! Continuing to photo...",
  "kiosk.voucher.invalid": "Invalid voucher code",
  "kiosk.voucher.error": "Network error, please try again.",
  "kiosk.voucher.no_session": "One moment, preparing your session...",
  "kiosk.voucher.preparing": "Preparing session, please wait...",
  "kiosk.voucher.empty": "Enter a voucher code",
  "kiosk.voucher.back": "Back",
  "kiosk.voucher.clear": "Clear All",
  "kiosk.voucher.backspace": "Delete",

  "kiosk.payment.title": "PAY WITH QRIS",
  "kiosk.payment.scan": "Scan the QR with your e-wallet",
  "kiosk.payment.providers": "GoPay, OVO, DANA, ShopeePay, BCA, all supported",
  "kiosk.payment.waiting": "Waiting for payment...",
  "kiosk.payment.expires_in": "QR valid for {time}",
  "kiosk.payment.expired": "QR expired, please try again.",
  "kiosk.payment.mock": "Mock mode — Xendit not configured.",

  "kiosk.paid.title": "Payment Successful! ✨",
  "kiosk.paid.subtitle": "Get ready, we'll take 3 photos.",
  "kiosk.paid.start_capture": "START SHOOTING",

  "kiosk.countdown.step": "Photo {n} of 3",
  "kiosk.countdown.smile": "Big smile! 😊",
  "kiosk.countdown.cheese": "Cheese!",
  "kiosk.countdown.get_ready": "GET READY!",

  "kiosk.processing.title": "Preparing your prints...",
  "kiosk.processing.subtitle": "Just a moment 🌿",

  "kiosk.preview.title": "READY! 🎉",
  "kiosk.preview.printing": "Printing now... Pick it up at the bottom slot",

  "kiosk.contact.title": "Want the soft files?",
  "kiosk.contact.subtitle": "We'll send them to your WhatsApp and Email.",
  "kiosk.contact.phone": "WhatsApp number (08xxxxxxxxxx)",
  "kiosk.contact.email": "Email (optional)",
  "kiosk.contact.send": "SEND",
  "kiosk.contact.skip": "Skip",
  "kiosk.contact.invalid_phone": "Invalid WhatsApp number",

  "kiosk.done.title": "Thank You! 💚",
  "kiosk.done.printed": "Your photos have been printed.",
  "kiosk.done.softfile": "Soft files will arrive via WhatsApp & Email.",
  "kiosk.done.tag": "Tag us on IG: @majakoffie",
  "kiosk.done.return": "Returning to start in {n} seconds...",

  "kiosk.error.unknown": "Something went wrong. Please call the operator.",
  "kiosk.cancel.confirm": "Cancel session? Payment will be voided.",
};

export const dictionary: Record<Lang, typeof id> = { id, en };

export type DictionaryKey = keyof typeof id;
