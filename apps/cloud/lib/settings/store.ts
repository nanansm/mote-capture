import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

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

export type SettingMap = {
  whatsapp: WhatsappSettings;
  email: EmailSettings;
  payment: PaymentSettings;
  general: GeneralSettings;
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
};

export async function getSetting<K extends keyof SettingMap>(key: K): Promise<SettingMap[K]> {
  const [row] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1);
  if (!row) return DEFAULTS[key];
  // Merge with defaults to tolerate older rows missing newer fields
  return { ...DEFAULTS[key], ...((row.value as object) ?? {}) } as SettingMap[K];
}

export async function setSetting<K extends keyof SettingMap>(
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
  return merged;
}

export async function getAllSettings(): Promise<SettingMap> {
  const rows = await db.select().from(schema.settings);
  const out: SettingMap = JSON.parse(JSON.stringify(DEFAULTS));
  for (const row of rows) {
    const k = row.key as keyof SettingMap;
    if (k in DEFAULTS) {
      (out as Record<string, unknown>)[k] = {
        ...(DEFAULTS as Record<string, unknown>)[k] as object,
        ...((row.value as object) ?? {}),
      };
    }
  }
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
