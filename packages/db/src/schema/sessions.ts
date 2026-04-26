import { sql } from "drizzle-orm";
import { integer, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { booths, captureSchema } from "./booths";
import { frames } from "./frames";

export const sessions = captureSchema.table("sessions", {
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
  paidAt: timestamp("paid_at"),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  photoCount: integer("photo_count").notNull().default(0),
  printCompletedAt: timestamp("print_completed_at"),
  downloadToken: text("download_token").unique(),
  downloadExpiresAt: timestamp("download_expires_at"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiredAt: timestamp("expired_at"),
});

export type SessionRow = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
