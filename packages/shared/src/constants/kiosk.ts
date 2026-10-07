// Timing constants for the kiosk state machine and BoothDO alarms.
// All values in milliseconds. Source of truth: docs/prd-booth-minipc.md
// bagian 5, 7, 8 (draft 3, 30 Sep 2026).
export const KIOSK_TIMING = {
  IDLE_RESET_MS: 5 * 60 * 1000, // PILIH_FRAME / KONFIRMASI / VOUCHER_INPUT tanpa sentuhan
  // Sama dengan `expires_at` QR Xendit dan alarm `qr_expiry` DO.
  PAYMENT_TIMEOUT_MS: 60_000,
  // PEMBAYARAN_OK tanpa tekan "Mulai Foto" -> IDLE. Sama dengan alarm
  // `paid_timeout` DO (SESSION_TIMING.PAID_START_TIMEOUT_MS).
  PAID_START_TIMEOUT_MS: 3 * 60 * 1000,
  GET_READY_MS: 10_000, // fase "Siap-siap" sebelum foto 1 saja
  // Hitung mundur murni. "TAHAN!" berakhir oleh event agent `shutter_fired`.
  COUNTDOWN_PER_PHOTO_MS: 5000,
  COUNTDOWN_TICK_MS: 1000,
  COUNTDOWN_FLASH_MS: 300,
  // Compose saja; cetak tidak ditunggu di layar.
  PROCESSING_TIMEOUT_MS: 20_000,
  // REVIEW_SHOT auto-maju ke foto berikutnya.
  REVIEW_SHOT_MS: 5000,
  DONE_AUTO_RESET_MS: 60_000, // waktu scan QR share
  // Tanpa `photo.ready` dari agent selama ini -> CALL_STAFF.
  CAPTURE_WAIT_MS: 15_000,
  PHOTO_COUNT: 4,
  // ws /agent/ws putus lebih lama dari ini -> CALL_STAFF.
  AGENT_WS_GRACE_MS: 10_000,
  // Kode voucher salah sebanyak ini -> kembali ke KONFIRMASI.
  VOUCHER_MAX_WRONG: 5,
  // `capture:start` ditolak DO (sesi sudah abandoned_paid): pesan tampil
  // selama ini lalu IDLE (PRD bagian 5 langkah 1).
  CAPTURE_REJECTED_NOTICE_MS: 10_000,
  // Halaman staf: 5 sentuhan pojok kiri atas dalam 3 detik (PRD bagian 6).
  STAFF_TAP_COUNT: 5,
  STAFF_TAP_WINDOW_MS: 3000,
  STAFF_PIN_LENGTH: 4,
  // Halaman staf tanpa sentuhan -> keluar (token agent sendiri 10 menit).
  STAFF_IDLE_MS: 2 * 60 * 1000,
  FRAMES_PER_PAGE: 4,
} as const;

// Alarm BoothDO per tahap (PRD bagian 7). Satu alarm per DO.
export const SESSION_TIMING = {
  QR_EXPIRY_MINUTES: 1,
  QR_EXPIRY_MS: KIOSK_TIMING.PAYMENT_TIMEOUT_MS,
  // Sesi voucher menunggu input kode; sama dengan IDLE_RESET kiosk.
  VOUCHER_INPUT_EXPIRY_MS: KIOSK_TIMING.IDLE_RESET_MS,
  PAID_START_TIMEOUT_MS: KIOSK_TIMING.PAID_START_TIMEOUT_MS,
  CAPTURE_TIMEOUT_MS: 10 * 60 * 1000,
} as const;

// Rate limit /api/voucher/redeem (PRD bagian 8 #9).
export const REDEEM_LIMITS = {
  PER_SESSION: 5,
  PER_BOOTH: 30,
  WINDOW_MS: 10 * 60 * 1000,
} as const;
