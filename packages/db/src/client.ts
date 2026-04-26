import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __captureSql?: ReturnType<typeof postgres>;
};

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not defined");
  }
  return url;
}

const sql =
  globalForDb.__captureSql ??
  postgres(getConnectionString(), {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__captureSql = sql;
}

export const db = drizzle(sql, { schema });
export { sql };
export type Database = typeof db;
