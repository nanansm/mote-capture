import { jsonb, serial, text, timestamp } from "drizzle-orm/pg-core";
import { captureSchema } from "./booths";

export const paymentLogs = captureSchema.table("payment_logs", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id"),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PaymentLogRow = typeof paymentLogs.$inferSelect;
export type PaymentLogInsert = typeof paymentLogs.$inferInsert;
