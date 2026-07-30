// ID / token generators — ported from apps/cloud/lib/id.ts and
// apps/cloud/lib/utils/token.ts. Workers have no `node:crypto`/`Buffer`, so
// everything here is rebuilt on Web Crypto (`crypto.randomUUID`,
// `crypto.getRandomValues`) plus plain string/array manipulation.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomAlphabetChars(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < length; i++) {
    s += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return s;
}

// Voucher codes share the same Crockford-ish alphabet (no 0/O/1/I/L) so the
// admin can read them aloud over WhatsApp without ambiguity. 8 chars gives
// ~10^12 combinations — collisions are vanishingly rare in practice but the
// `code` column is UNIQUE so we'd just retry on the off chance.
export function generateVoucherCode(length = 8): string {
  return randomAlphabetChars(length);
}

export function generateVoucherId(): string {
  return `VCH-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

export function generateBatchId(): string {
  return `BATCH-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

export function generateBoothId(): string {
  return `BOOTH-${randomAlphabetChars(6)}`;
}

export function generateFrameId(): string {
  return `FRM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function generateBridgeToken(): string {
  return crypto.randomUUID();
}

export function generateUploadName(ext: string): string {
  return `${crypto.randomUUID()}.${ext}`;
}

export function generateSessionId(): string {
  // 8-char uppercase chunk derived from a UUID — stable, easy to read aloud.
  return `SES-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function generateDownloadToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}
