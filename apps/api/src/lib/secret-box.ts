// AES-GCM envelope for credentials the admin edits from the UI.
//
// Why encrypt at all: moving Xendit / Evolution credentials out of Worker
// secrets and into D1 is what makes them editable without a deploy, but it is
// also a downgrade in blast radius — a Worker secret cannot be read back once
// set, while a D1 row can be read by anything that can reach the database
// (a leaked Cloudflare API token, a future injection bug, a dashboard export).
// This app already had one compromise (3 Jul 2026), and the Xendit secret key
// moves real money, so the row stores ciphertext instead of the raw key.
//
// The wrapping key comes from the SETTINGS_ENC_KEY Worker secret, which is set
// once and then never touched again — rotating a payment credential stays a
// UI action, which is the whole point of the feature.
//
// Format: `v1.<base64url(iv)>.<base64url(ciphertext+tag)>`. The version prefix
// exists so a future algorithm change can be detected rather than guessed at.
const FORMAT_VERSION = "v1";
const IV_BYTES = 12; // AES-GCM standard nonce length

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// SHA-256 of the passphrase, used directly as the 256-bit AES key. No KDF
// stretching on purpose: SETTINGS_ENC_KEY is expected to be high-entropy
// random (the setup docs generate it with `openssl rand -base64 32`), and a
// slow KDF would only tax every request without adding entropy that isn't
// already there.
async function importKey(passphrase: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passphrase));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(`${FORMAT_VERSION}.`);
}

export async function encryptSecret(plaintext: string, passphrase: string): Promise<string> {
  const key = await importKey(passphrase);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${FORMAT_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

// Returns null instead of throwing when the envelope cannot be opened — a
// wrong/rotated SETTINGS_ENC_KEY must degrade to "credential not configured"
// (which falls back to the Worker-secret value) rather than 500 the checkout
// path mid-session.
export async function decryptSecret(
  envelope: string,
  passphrase: string,
): Promise<string | null> {
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== FORMAT_VERSION) return null;
  const [, ivPart, dataPart] = parts as [string, string, string];
  try {
    const key = await importKey(passphrase);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(ivPart) },
      key,
      fromBase64Url(dataPart),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

// What the admin UI is allowed to see: enough to recognise which key is
// installed, never enough to reconstruct it. Short values are fully masked
// rather than half-revealed.
export function maskSecret(plaintext: string): string {
  if (!plaintext) return "";
  if (plaintext.length <= 8) return "••••••••";
  return `••••••••${plaintext.slice(-4)}`;
}
