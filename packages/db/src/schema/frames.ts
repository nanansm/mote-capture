import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { booths, captureSchema } from "./booths";

export const frames = captureSchema.table("frames", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tier: text("tier").notNull().default("regular"),
  price: integer("price").notNull().default(30000),
  backgroundUrl: text("background_url"),
  logoUrl: text("logo_url"),
  previewUrl: text("preview_url"),
  layoutJson: jsonb("layout_json").notNull().default(sql`'{}'::jsonb`),
  boothId: text("booth_id").references(() => booths.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  seasonStart: timestamp("season_start"),
  seasonEnd: timestamp("season_end"),
  sortOrder: integer("sort_order").notNull().default(0),
  usesCount: integer("uses_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type FrameRow = typeof frames.$inferSelect;
export type FrameInsert = typeof frames.$inferInsert;
