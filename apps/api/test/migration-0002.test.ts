import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("migrasi 0002 vouchers.source", () => {
  it("kolom baru ada, default manual", async () => {
    await env.DB.prepare("INSERT INTO vouchers (id, code, type, value) VALUES ('V1', 'MANUAL01', 'payment', 30000)").run();
    const row = await env.DB.prepare("SELECT source, source_session_id FROM vouchers WHERE id = 'V1'").first();
    expect(row).toEqual({ source: "manual", source_session_id: null });
  });

  it("satu sesi maksimal satu voucher per sumber otomatis", async () => {
    const ins = (id: string, code: string, source: string) =>
      env.DB.prepare(
        "INSERT INTO vouchers (id, code, type, value, source, source_session_id) VALUES (?, ?, 'payment', 30000, ?, 'S-1')",
      )
        .bind(id, code, source)
        .run();
    await ins("V2", "AUTO0001", "auto-abandoned");
    await expect(ins("V3", "AUTO0002", "auto-abandoned")).rejects.toThrow(/UNIQUE/);
    await expect(ins("V4", "AUTO0003", "staff-cancel")).resolves.toBeTruthy();
  });
});
