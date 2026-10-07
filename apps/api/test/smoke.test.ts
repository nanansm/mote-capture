import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("harness", () => {
  it("serves /api/health from the real worker", async () => {
    const res = await SELF.fetch("https://capture.test/api/health");
    expect(res.status).toBe(200);
  });

  it("has the D1 schema from migrations/", async () => {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'",
    ).first<{ name: string }>();
    expect(row?.name).toBe("sessions");
  });
});
