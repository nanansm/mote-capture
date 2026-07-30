// Ported from apps/cloud/lib/settings/store.ts. Two changes from the old
// module:
//   - No module-level `db` singleton import (apps/cloud/lib/settings/store.ts:2
//     imported `db` from "@/lib/db"). The D1 binding only exists per-request
//     (off `c.env`), so every function here takes a `Database` instance
//     (from `getDb(c.env.DB)`) as its first argument instead.
//   - `getAllSettings` gets a module-level cache with a 60s TTL. The bridge
//     polls this endpoint every ~30s (per booth, and there can be several
//     booths), so without a cache each heartbeat round costs a full D1
//     `settings` table scan. `setSetting` calls `invalidateSettingsCache()`
//     so an admin's change is visible on the very next read, not after the
//     TTL expires.
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { schema } from "@/db";

export type WhatsappSettings = {
  enabled: boolean;
  template: string;
};

export type EmailSettings = {
  enabled: boolean;
  from_name: string;
  subject?: string;
};

export type PaymentSettings = {
  default_provider: "xendit" | "ipaymu";
};

export type GeneralSettings = {
  booth_alert_offline_minutes: number;
};

// Operational credentials the admin can rotate from the UI without a deploy.
// Every field holds an AES-GCM envelope from lib/secret-box.ts, never a raw
// key — see that file for why. An empty string means "not set here", which
// makes the resolver fall back to the matching Worker secret.
export type CredentialSettings = {
  xendit_secret_key: string;
  xendit_webhook_token: string;
  evolution_api_url: string;
  evolution_api_key: string;
  evolution_instance_name: string;
};

export type SettingMap = {
  whatsapp: WhatsappSettings;
  email: EmailSettings;
  payment: PaymentSettings;
  general: GeneralSettings;
  credentials: CredentialSettings;
};

const DEFAULTS: SettingMap = {
  whatsapp: {
    enabled: false,
    template:
      "Halo! 👋\n\nTerima kasih sudah berfoto di Maja Photobooth.\n\nFoto kamu siap di-download di sini:\n{link}\n\nLink berlaku 7 hari ya.\n\n— Maja Photobooth 📸",
  },
  email: { enabled: false, from_name: "Mote Capture", subject: "Foto Kamu Sudah Siap! 📸" },
  payment: { default_provider: "xendit" },
  general: { booth_alert_offline_minutes: 5 },
  credentials: {
    xendit_secret_key: "",
    xendit_webhook_token: "",
    evolution_api_url: "",
    evolution_api_key: "",
    evolution_instance_name: "",
  },
};

// ---------------------------------------------------------------------------
// getAllSettings cache — module-level, TTL 60s (see file header).
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;
let cache: { value: SettingMap; expiresAt: number } | undefined;

export function invalidateSettingsCache(): void {
  cache = undefined;
}

export async function getSetting<K extends keyof SettingMap>(
  db: Database,
  key: K,
): Promise<SettingMap[K]> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1);
  if (!row) return DEFAULTS[key];
  // Merge with defaults to tolerate older rows missing newer fields
  return { ...DEFAULTS[key], ...((row.value as object) ?? {}) } as SettingMap[K];
}

export async function setSetting<K extends keyof SettingMap>(
  db: Database,
  key: K,
  value: SettingMap[K],
): Promise<SettingMap[K]> {
  const merged = { ...DEFAULTS[key], ...(value as object) } as SettingMap[K];
  await db
    .insert(schema.settings)
    .values({ key, value: merged as unknown as Record<string, unknown>, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: merged as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
  invalidateSettingsCache();
  return merged;
}

export async function getAllSettings(db: Database): Promise<SettingMap> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  const rows = await db.select().from(schema.settings);
  const out: SettingMap = JSON.parse(JSON.stringify(DEFAULTS));
  for (const row of rows) {
    const k = row.key as keyof SettingMap;
    if (k in DEFAULTS) {
      (out as Record<string, unknown>)[k] = {
        ...((DEFAULTS as Record<string, unknown>)[k] as object),
        ...((row.value as object) ?? {}),
      };
    }
  }

  cache = { value: out, expiresAt: now + CACHE_TTL_MS };
  return out;
}

export function renderTemplate(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined ? `{${key}}` : v;
  });
}

export function formatDateID(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
