import { randomBytes, randomUUID } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Voucher codes share the same Crockford-ish alphabet (no 0/O/1/I/L) so the
// admin can read them aloud over WhatsApp without ambiguity. 8 chars gives
// ~10^12 combinations — collisions are vanishingly rare in practice but the
// `code` column is UNIQUE so we'd just retry on the off chance.
export function generateVoucherCode(length = 8): string {
  const bytes = randomBytes(length);
  let s = "";
  for (let i = 0; i < length; i++) {
    s += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return s;
}

export function generateVoucherId(): string {
  return `VCH-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

export function generateBatchId(): string {
  return `BATCH-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

export function generateBoothId(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `BOOTH-${s}`;
}

export function generateFrameId(): string {
  return `FRM-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function generateBridgeToken(): string {
  return randomUUID();
}

export function generateUploadName(ext: string): string {
  return `${randomUUID()}.${ext}`;
}
