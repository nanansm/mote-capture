// Timing constants for kiosk state machine. All values in milliseconds.
export const KIOSK_TIMING = {
  IDLE_RESET_MS: 5 * 60 * 1000, // 5 min
  PAYMENT_TIMEOUT_MS: 5 * 60 * 1000,
  COUNTDOWN_PER_PHOTO_MS: 8000, // 5s countdown + 3s capture window
  COUNTDOWN_TICK_MS: 1000,
  COUNTDOWN_FLASH_MS: 300,
  PROCESSING_TIMEOUT_MS: 30_000,
  PREVIEW_AUTO_ADVANCE_MS: 5000,
  CONTACT_TIMEOUT_MS: 60_000,
  DONE_AUTO_RESET_MS: 8000,
  CAPTURE_WAIT_MS: 60_000, // wait per photo from bridge
  PHOTO_COUNT: 3,
} as const;

export const MOCK_BRIDGE = {
  CAPTURE_DELAY_MS: 8000,
  COMPOSITE_DELAY_MS: 3000,
  PRINT_DELAY_MS: 5000,
} as const;
