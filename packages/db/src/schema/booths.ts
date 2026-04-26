import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const captureSchema = pgSchema("capture");

export const booths = captureSchema.table("booths", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  defaultPrice: integer("default_price").notNull().default(30000),
  paymentProvider: text("payment_provider").notNull().default("ipaymu"),
  bridgeToken: text("bridge_token").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at"),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BoothRow = typeof booths.$inferSelect;
export type BoothInsert = typeof booths.$inferInsert;
