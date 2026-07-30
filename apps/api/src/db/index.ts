import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

export { schema };
export * from "@/db/schema";

// No module-level singleton: the D1 binding is only available per-request
// (it comes off `c.env` in the Hono context), so a fresh drizzle instance is
// created from whatever binding is passed in rather than cached here.
export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof getDb>;
