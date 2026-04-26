import { randomBytes, randomUUID } from "node:crypto";

export function generateDownloadToken(): string {
  return randomBytes(24).toString("base64url");
}

export function generateSessionId(): string {
  // 8-char uppercase chunk derived from a UUID — stable, easy to read aloud.
  return `SES-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}
