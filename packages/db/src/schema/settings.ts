import { jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { captureSchema } from "./booths";

export const settings = captureSchema.table("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SettingRow = typeof settings.$inferSelect;
export type SettingInsert = typeof settings.$inferInsert;
