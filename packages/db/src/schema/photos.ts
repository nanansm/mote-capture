import { boolean, integer, text, timestamp } from "drizzle-orm/pg-core";
import { captureSchema } from "./booths";
import { sessions } from "./sessions";

export const photos = captureSchema.table("photos", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  isFinal: boolean("is_final").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PhotoRow = typeof photos.$inferSelect;
export type PhotoInsert = typeof photos.$inferInsert;
