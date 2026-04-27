import { sql } from "drizzle-orm";
import { index, integer, jsonb, serial, text, timestamp } from "drizzle-orm/pg-core";
import { captureSchema } from "./booths";

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
export const vouchers = captureSchema.table(
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
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: text("created_by"),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
export const voucherRedemptions = captureSchema.table("voucher_redemptions", {
  id: serial("id").primaryKey(),
  voucherId: text("voucher_id")
    .notNull()
    .references(() => vouchers.id),
  sessionId: text("session_id").notNull(),
  boothId: text("booth_id").notNull(),
  originalAmount: integer("original_amount").notNull(),
  finalAmount: integer("final_amount").notNull(),
  discountApplied: integer("discount_applied").notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VoucherType = "payment" | "discount";
export type VoucherStatus = "active" | "used" | "expired" | "disabled";

export type VoucherRow = typeof vouchers.$inferSelect;
export type VoucherInsert = typeof vouchers.$inferInsert;
export type VoucherRedemptionRow = typeof voucherRedemptions.$inferSelect;
export type VoucherRedemptionInsert = typeof voucherRedemptions.$inferInsert;
