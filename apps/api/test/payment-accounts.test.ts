import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SocketEvents } from "@capture/shared";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getSessionRow, seedBooth, seedFrame, seedPaymentAccount, uid, useAccount } from "./helpers";
import { openKiosk } from "./ws";

// Akun pembayaran per booth: CRUD admin, key tidak bocor, isolasi antar booth.

async function admin(path: string, method: string, body?: unknown) {
  const t = await createSessionToken("admin@test.local", env.BETTER_AUTH_SECRET!);
  return SELF.fetch(`https://capture.test/api${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE_NAME}=${t}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type Acc = {
  id: string;
  provider: string;
  mode: string;
  masked: Record<string, string>;
  complete: boolean;
  webhookUrl: string;
  usedBy: { id: string }[];
  lastTest: { ok: boolean } | null;
};

const XENDIT_KEY = "xnd_development_RAHASIA1234567890abcdef";
const IPAYMU_KEY = "SANDBOX-RAHASIA-APIKEY-9999";

afterEach(() => vi.restoreAllMocks());

describe("API /api/payment-accounts", () => {
  it("tanpa login: 401", async () => {
    const res = await SELF.fetch("https://capture.test/api/payment-accounts");
    expect(res.status).toBe(401);
  });

  it("buat akun Xendit: key tidak pernah dikirim balik utuh", async () => {
    const res = await admin("/payment-accounts", "POST", {
      name: "Xendit Maja",
      provider: "xendit",
      mode: "sandbox",
      secrets: { secretKey: XENDIT_KEY, webhookToken: "tok-maja-123456" },
    });
    expect(res.status).toBe(201);
    const raw = await res.text();
    expect(raw).not.toContain(XENDIT_KEY);
    expect(raw).not.toContain("tok-maja-123456");
    const { data } = JSON.parse(raw) as { data: Acc };
    expect(data.complete).toBe(true);
    expect(data.webhookUrl).toMatch(new RegExp(`/api/webhook/xendit/${data.id}$`));

    const list = await (await admin("/payment-accounts", "GET")).text();
    expect(list).not.toContain(XENDIT_KEY);
    // Kolom D1 berisi amplop terenkripsi, bukan key.
    const row = await env.DB.prepare("SELECT credentials FROM payment_accounts WHERE id = ?").bind(data.id).first<{ credentials: string }>();
    expect(row?.credentials).not.toContain(XENDIT_KEY);
  });

  it("field wajib kosong ditolak dengan nama field", async () => {
    const res = await admin("/payment-accounts", "POST", {
      name: "iPaymu tanpa key",
      provider: "ipaymu",
      secrets: { va: "1179000899" },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/API Key/);
  });

  it("salah tempel Public Key Xendit ditolak", async () => {
    const res = await admin("/payment-accounts", "POST", {
      name: "Salah",
      provider: "xendit",
      secrets: { secretKey: "xnd_public_development_abc", webhookToken: "t" },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Public Key/);
  });

  it("key development di mode production ditolak", async () => {
    const res = await admin("/payment-accounts", "POST", {
      name: "Salah mode",
      provider: "xendit",
      mode: "production",
      secrets: { secretKey: XENDIT_KEY, webhookToken: "t" },
    });
    expect(res.status).toBe(400);
  });

  it("VA iPaymu bukan angka ditolak", async () => {
    const res = await admin("/payment-accounts", "POST", {
      name: "VA salah",
      provider: "ipaymu",
      secrets: { va: "11-79", apiKey: "k" },
    });
    expect(res.status).toBe(400);
  });

  it("edit: field kosong = key lama dipertahankan, ganti nama saja", async () => {
    const created = (await (
      await admin("/payment-accounts", "POST", {
        name: "iPaymu smnanan",
        provider: "ipaymu",
        mode: "sandbox",
        secrets: { va: "1179000899", apiKey: IPAYMU_KEY },
      })
    ).json()) as { data: Acc };
    const res = await admin(`/payment-accounts/${created.data.id}`, "PATCH", {
      name: "iPaymu smnanan (baru)",
      secrets: { va: "", apiKey: "" },
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Acc & { name: string } };
    expect(data.name).toBe("iPaymu smnanan (baru)");
    expect(data.complete).toBe(true);
    expect(data.masked.va).toBe("1179000899");
    expect(data.masked.apiKey).not.toBe(IPAYMU_KEY);
    expect(data.masked.apiKey).not.toBe("");
  });

  it("tes koneksi memakai key akun itu dan menyimpan hasilnya", async () => {
    const id = await seedPaymentAccount({ provider: "xendit", mode: "sandbox", secrets: { secretKey: XENDIT_KEY, webhookToken: "t" } });
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(String(input)).toBe("https://api.xendit.co/balance");
      expect(new Headers(init?.headers).get("authorization")).toBe("Basic " + btoa(`${XENDIT_KEY}:`));
      return Response.json({ balance: 0 });
    });
    const res = await admin(`/payment-accounts/${id}/test`, "POST");
    expect(await res.json()).toMatchObject({ success: true });
    expect(spy).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    const list = (await (await admin("/payment-accounts", "GET")).json()) as { data: Acc[] };
    expect(list.data.find((a) => a.id === id)?.lastTest?.ok).toBe(true);
  });

  it("akun yang dipakai booth tidak bisa dihapus; setelah dilepas bisa", async () => {
    const id = await seedPaymentAccount({ provider: "xendit", mode: "sandbox", secrets: { secretKey: XENDIT_KEY, webhookToken: "t" } });
    const boothId = await seedBooth({ id: uid("BTH") });
    await useAccount(boothId, id);
    const blocked = await admin(`/payment-accounts/${id}`, "DELETE");
    expect(blocked.status).toBe(409);
    await useAccount(boothId, null);
    expect((await admin(`/payment-accounts/${id}`, "DELETE")).status).toBe(200);
  });
});

describe("booth memilih akun", () => {
  it("PATCH booth dengan akun: provider ikut akun", async () => {
    const id = await seedPaymentAccount({ provider: "ipaymu", mode: "sandbox", secrets: { va: "1", apiKey: "k" } });
    const boothId = await seedBooth({ id: uid("BTH") });
    const res = await admin(`/booths/${boothId}`, "PATCH", { paymentAccountId: id });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { paymentProvider: string; paymentAccountId: string } };
    expect(data).toMatchObject({ paymentProvider: "ipaymu", paymentAccountId: id });
  });

  it("akun tidak ada: 400", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const res = await admin(`/booths/${boothId}`, "PATCH", { paymentAccountId: "PAY-TIDAKADA" });
    expect(res.status).toBe(400);
  });
});

describe("sesi QRIS per booth", () => {
  async function boothWith(accountId: string | null, provider = "xendit") {
    const boothId = await seedBooth({ id: uid("BTH") });
    await useAccount(boothId, accountId, provider);
    const frameId = await seedFrame({ boothId });
    return { boothId, frameId };
  }

  it("booth tanpa akun: QRIS ditolak jelas, tanpa sesi palsu", async () => {
    const { boothId, frameId } = await boothWith(null);
    const k = await openKiosk(boothId);
    const r = (await k.request(SocketEvents.CONFIRM_AND_PAY, { boothId, frameId, method: "qris" })) as {
      ok: boolean;
      code?: string;
    };
    k.close();
    expect(r.ok).toBe(false);
    expect(r.code).toBe("PAYMENT_NOT_CONFIGURED");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE booth_id = ?").bind(boothId).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("booth tanpa akun: voucher tetap jalan", async () => {
    const { boothId, frameId } = await boothWith(null);
    const k = await openKiosk(boothId);
    const r = await k.request(SocketEvents.CONFIRM_AND_PAY, { boothId, frameId, method: "voucher" });
    k.close();
    expect(r.ok).toBe(true);
  });

  it("dua booth, dua akun iPaymu: tiap QR dibuat dengan VA akunnya sendiri", async () => {
    const accA = await seedPaymentAccount({ provider: "ipaymu", mode: "sandbox", secrets: { va: "1110001", apiKey: "KEY-A" } });
    const accB = await seedPaymentAccount({ provider: "ipaymu", mode: "sandbox", secrets: { va: "2220002", apiKey: "KEY-B" } });
    const a = await boothWith(accA, "ipaymu");
    const b = await boothWith(accB, "ipaymu");
    const seen: { va: string | null; notify: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      seen.push({ va: new Headers(init?.headers).get("va"), notify: body.notifyUrl });
      return Response.json({ Status: 200, Data: { TransactionId: 100 + seen.length, QrString: "000201QR" } });
    });

    const sessions: string[] = [];
    for (const x of [a, b]) {
      const k = await openKiosk(x.boothId);
      const r = (await k.request(SocketEvents.CONFIRM_AND_PAY, { boothId: x.boothId, frameId: x.frameId, method: "qris" })) as {
        ok: boolean;
        data?: { sessionId: string };
      };
      k.close();
      expect(r.ok).toBe(true);
      sessions.push(r.data!.sessionId);
    }
    expect(seen.map((s) => s.va)).toEqual(["1110001", "2220002"]);
    expect(String(seen[0]!.notify)).toMatch(new RegExp(`/api/webhook/ipaymu/${accA}$`));
    expect(String(seen[1]!.notify)).toMatch(new RegExp(`/api/webhook/ipaymu/${accB}$`));
    expect((await getSessionRow(sessions[0]!))?.payment_account_id).toBe(accA);
    expect((await getSessionRow(sessions[1]!))?.payment_account_id).toBe(accB);
  });
});
