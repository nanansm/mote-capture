import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Converted from packages/db/src/schema/*.ts (Postgres/Drizzle) to
// drizzle-orm/sqlite-core for Cloudflare D1. Notes:
//   - The `capture` Postgres schema is dropped; table names are unprefixed.
//   - `admins` table is intentionally NOT ported (auth is env-var based).
//   - Any column that stored an absolute R2 URL now stores just the R2
//     object key (`*_key`) — the URL is built at runtime as
//     `${PUBLIC_CDN_URL}/${key}`.
//   - Timestamps are `integer(mode: "timestamp_ms")` — epoch milliseconds.
//   - JSON columns are `text(mode: "json")`.

const now = sql`(unixepoch() * 1000)`;

export const booths = sqliteTable(
  "booths",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    location: text("location"),
    defaultPrice: integer("default_price").notNull().default(30000),
    paymentProvider: text("payment_provider").notNull().default("ipaymu"),
    bridgeToken: text("bridge_token").notNull().unique(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    metadata: text("metadata", { mode: "json" }).default(sql`'{}'`),
    paymentCredentials: text("payment_credentials", { mode: "json" }).default(sql`'{}'`),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (table) => ({
    activeIdx: index("idx_booths_active").on(table.isActive),
  }),
);

export type BoothRow = typeof booths.$inferSelect;
export type BoothInsert = typeof booths.$inferInsert;

export const frames = sqliteTable(
  "frames",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Postgres migration (packages/db/migrations/0001_init.sql:25) has a
    // CHECK(tier IN ('regular','premium')) that was never reflected in the
    // old TS schema — carried forward here since it's a real DB constraint.
    tier: text("tier").notNull().default("regular"),
    price: integer("price").notNull().default(30000),
    // Renamed from backgroundUrl/logoUrl/previewUrl: these now hold R2 object
    // keys, not absolute URLs.
    backgroundKey: text("background_key"),
    logoKey: text("logo_key"),
    previewKey: text("preview_key"),
    layoutJson: text("layout_json", { mode: "json" }).notNull().default(sql`'{}'`),
    boothId: text("booth_id").references(() => booths.id, { onDelete: "set null" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    seasonStart: integer("season_start", { mode: "timestamp_ms" }),
    seasonEnd: integer("season_end", { mode: "timestamp_ms" }),
    sortOrder: integer("sort_order").notNull().default(0),
    usesCount: integer("uses_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (table) => ({
    activeIdx: index("idx_frames_active").on(table.isActive),
    boothIdx: index("idx_frames_booth").on(table.boothId),
    tierCheck: check("frames_tier_check", sql`${table.tier} IN ('regular', 'premium')`),
  }),
);

export type FrameRow = typeof frames.$inferSelect;
export type FrameInsert = typeof frames.$inferInsert;

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    boothId: text("booth_id")
      .notNull()
      .references(() => booths.id),
    frameId: text("frame_id").references(() => frames.id),
    status: text("status").notNull().default("idle"),
    amount: integer("amount").notNull(),
    paymentProvider: text("payment_provider"),
    paymentRef: text("payment_ref"),
    qrString: text("qr_string"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone"),
    photoCount: integer("photo_count").notNull().default(0),
    printCompletedAt: integer("print_completed_at", { mode: "timestamp_ms" }),
    downloadToken: text("download_token").unique(),
    downloadExpiresAt: integer("download_expires_at", { mode: "timestamp_ms" }),
    metadata: text("metadata", { mode: "json" }).default(sql`'{}'`),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    expiredAt: integer("expired_at", { mode: "timestamp_ms" }),
  },
  (table) => ({
    boothIdx: index("idx_sessions_booth").on(table.boothId),
    statusIdx: index("idx_sessions_status").on(table.status),
    downloadTokenIdx: index("idx_sessions_download_token").on(table.downloadToken),
    createdAtIdx: index("idx_sessions_created_at").on(table.createdAt),
    paymentRefIdx: index("idx_sessions_payment_ref").on(table.paymentRef),
  }),
);

export type SessionRow = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;

export const photos = sqliteTable(
  "photos",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    // Renamed from `url`: holds the R2 object key, not an absolute URL.
    r2Key: text("r2_key").notNull(),
    isFinal: integer("is_final", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (table) => ({
    sessionIdx: index("idx_photos_session").on(table.sessionId),
  }),
);

export type PhotoRow = typeof photos.$inferSelect;
export type PhotoInsert = typeof photos.$inferInsert;

export const paymentLogs = sqliteTable(
  "payment_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id"),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (table) => ({
    sessionIdx: index("idx_payment_logs_session").on(table.sessionId),
  }),
);

export type PaymentLogRow = typeof paymentLogs.$inferSelect;
export type PaymentLogInsert = typeof paymentLogs.$inferInsert;

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  // packages/db/src/schema/settings.ts:6 has no default, but
  // packages/db/migrations/0002_sprint2.sql:6 defines the column as
  // `NOT NULL DEFAULT '{}'::jsonb` — the migration (real DB state) wins.
  value: text("value", { mode: "json" }).notNull().default(sql`'{}'`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export type SettingRow = typeof settings.$inferSelect;
export type SettingInsert = typeof settings.$inferInsert;

// Vouchers issued by admin. Two semantic types:
//   - "payment":  value is the IDR nominal it covers (e.g. 30000). If it's
//                 >= session.amount it pays the full session; otherwise the
//                 difference falls to the user (Sprint 3 will route the gap
//                 through QRIS — Sprint 1.5 marks the session paid either way).
//   - "discount": value is a percentage 1-100 that reduces session.amount.
//
// Status transitions: active -> used (limit hit) | expired (past expiresAt) |
// disabled (manually deactivated by admin).
//
// Quota: `limit = 0` means unlimited reuse; `limit > 0` is hard-capped by
// `usedCount` and the redeem endpoint flips status to "used" when the cap
// is reached.
export const vouchers = sqliteTable(
  "vouchers",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    type: text("type").notNull(), // 'payment' | 'discount'
    value: integer("value").notNull(),
    limit: integer("limit").notNull().default(1),
    usedCount: integer("used_count").notNull().default(0),
    status: text("status").notNull().default("active"),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    customerWhatsapp: text("customer_whatsapp"),
    batchId: text("batch_id"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by"),
    metadata: text("metadata", { mode: "json" }).default(sql`'{}'`),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (table) => ({
    codeIdx: index("vouchers_code_idx").on(table.code),
    statusIdx: index("vouchers_status_idx").on(table.status),
    batchIdx: index("vouchers_batch_idx").on(table.batchId),
  }),
);

// Append-only ledger of every voucher redemption. Joins voucher → session
// without touching the session row itself (the session has its own paid_at /
// status fields). Keeps audit trail even if the session row is later deleted.
export const voucherRedemptions = sqliteTable(
  "voucher_redemptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    voucherId: text("voucher_id")
      .notNull()
      .references(() => vouchers.id),
    sessionId: text("session_id").notNull(),
    boothId: text("booth_id").notNull(),
    originalAmount: integer("original_amount").notNull(),
    finalAmount: integer("final_amount").notNull(),
    discountApplied: integer("discount_applied").notNull(),
    redeemedAt: integer("redeemed_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (table) => ({
    voucherIdx: index("voucher_redemptions_voucher_idx").on(table.voucherId),
    sessionIdx: index("voucher_redemptions_session_idx").on(table.sessionId),
  }),
);

export type VoucherType = "payment" | "discount";
export type VoucherStatus = "active" | "used" | "expired" | "disabled";

export type VoucherRow = typeof vouchers.$inferSelect;
export type VoucherInsert = typeof vouchers.$inferInsert;
export type VoucherRedemptionRow = typeof voucherRedemptions.$inferSelect;
export type VoucherRedemptionInsert = typeof voucherRedemptions.$inferInsert;
