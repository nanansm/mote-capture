import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside workerd (Miniflare), against the real wrangler.jsonc
// bindings but fully local: D1/R2/DO storage is isolated per test file and
// never touches the remote "mote-capture" database or "mote-capture-prod"
// bucket. `remoteBindings: false` is explicit so a future wrangler default
// change cannot silently point tests at production.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    resolve: { alias: { "@": path.join(__dirname, "src") } },
    plugins: [
      cloudflareTest({
        main: "./src/index.ts",
        remoteBindings: false,
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_EMAIL: "admin@test.local",
            ADMIN_PASSWORD: "test-password",
            BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-00",
            XENDIT_WEBHOOK_TOKEN: "test-webhook-token",
            SETTINGS_ENC_KEY: "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktMDA=",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      include: ["test/**/*.test.ts"],
    },
  };
});
