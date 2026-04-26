import { randomUUID } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
