import { applyD1Migrations, env } from "cloudflare:test";

// Runs before every test file. applyD1Migrations is idempotent (tracks
// applied names), so the real migrations/ folder is the only schema source:
// a test can never pass against a schema production does not have.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
