// Re-export the shared Drizzle client so route handlers can `import { db } from "@/lib/db"`.
export { db, sql } from "@capture/db/client";
export type { Database } from "@capture/db/client";
export { schema } from "@capture/db";
