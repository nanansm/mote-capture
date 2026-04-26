import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

async function loadEnvFile(path: string): Promise<void> {
  try {
    const content = await readFile(path, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // file optional
  }
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../..");

  // Load env from repo root (.env.local takes priority)
  await loadEnvFile(join(repoRoot, ".env.local"));
  await loadEnvFile(join(repoRoot, ".env"));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not defined (checked env, .env.local, .env)");
  }

  const migrationsDir = resolve(here, "..", "migrations");
  const entries = await readdir(migrationsDir);
  const sqlFiles = entries.filter((f) => f.endsWith(".sql")).sort();

  if (sqlFiles.length === 0) {
    console.log("[migrate] no migration files found");
    return;
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    // Ensure schema and migrations registry exist
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS capture;`);
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS capture._migrations (
        id TEXT PRIMARY KEY,
        executed_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    const executed = await sql<{ id: string }[]>`
      SELECT id FROM capture._migrations
    `;
    const executedIds = new Set(executed.map((r) => r.id));

    let appliedCount = 0;
    for (const file of sqlFiles) {
      if (executedIds.has(file)) {
        console.log(`[migrate] skip   ${file} (already applied)`);
        continue;
      }
      const filePath = join(migrationsDir, file);
      const content = await readFile(filePath, "utf8");
      console.log(`[migrate] apply  ${file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO capture._migrations (id) VALUES (${file})`;
      });
      appliedCount += 1;
    }

    console.log(
      appliedCount === 0
        ? "[migrate] up to date — no migrations applied"
        : `[migrate] done — ${appliedCount} migration(s) applied`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
