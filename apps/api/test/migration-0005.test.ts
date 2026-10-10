import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("migrasi 0005 provider doku", () => {
  it("provider doku diterima, provider asing tetap ditolak", async () => {
    await env.DB.prepare("INSERT INTO payment_accounts (id, name, provider, credentials) VALUES ('PAY-M5A', 'a', 'doku', 'x')").run();
    await expect(
      env.DB.prepare("INSERT INTO payment_accounts (id, name, provider, credentials) VALUES ('PAY-M5B', 'b', 'paypal', 'x')").run(),
    ).rejects.toThrow(/CHECK/);
  });

  it("booth tetap bisa menunjuk akun setelah tabel dibangun ulang", async () => {
    await env.DB.prepare("INSERT INTO payment_accounts (id, name, provider, credentials) VALUES ('PAY-M5C', 'c', 'ipaymu', 'x')").run();
    await env.DB.prepare("INSERT INTO booths (id, name, bridge_token, payment_account_id) VALUES ('BTH-M5', 'b', 'tok-m5', 'PAY-M5C')").run();
    const row = await env.DB.prepare("SELECT payment_account_id FROM booths WHERE id = 'BTH-M5'").first();
    expect(row).toEqual({ payment_account_id: "PAY-M5C" });
    const idx = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_payment_accounts_provider'").first();
    expect(idx).toBeTruthy();
  });
});
