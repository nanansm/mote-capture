import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SESSION_TIMING, SocketEvents } from "@capture/shared";
import { getSessionRow, seedBooth, seedSession, uid } from "./helpers";
import { openKiosk } from "./ws";

// U4 (alarm per tahap) + U5 (markDone) — PRD bagian 7, 8 #2/#6/#13/#15/#16, 13.

const stub = (boothId: string) => env.BOOTH_DO.get(env.BOOTH_DO.idFromName(boothId));

async function setup(status = "payment", amount = 30000) {
  const token = `tok-${uid("T")}`;
  const boothId = await seedBooth({ id: uid("BTH"), token });
  const sessionId = await seedSession({ boothId, status, amount, downloadToken: `dl-${uid("D")}` });
  return { boothId, sessionId, token };
}

const autoVouchers = (sessionId: string) =>
  env.DB.prepare("SELECT id, code, value, status, source, used_count, metadata FROM vouchers WHERE source_session_id = ?")
    .bind(sessionId)
    .all<Record<string, unknown>>()
    .then((r) => r.results);

const alarmState = (boothId: string) =>
  runInDurableObject(stub(boothId), async (_i, state) => ({
    task: await state.storage.get<{ type: string; sessionId: string }>("alarm:task"),
    at: await state.storage.getAlarm(),
  }));

const bridgePost = (path: string, token: string, body?: unknown) =>
  SELF.fetch(`https://capture.test/api/bridge${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const putPhoto = (sessionId: string, token: string, sortOrder: number | string, type = "image/jpeg") =>
  SELF.fetch(`https://capture.test/api/session/${sessionId}/photos?sortOrder=${sortOrder}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": type, "content-length": "4" },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  });

describe("U4 alarm per tahap", () => {
  it("payment: alarm qr_expiry 60 detik -> expired", async () => {
    const { boothId, sessionId } = await setup("payment");
    await runInDurableObject(stub(boothId), async (_i, state) => {
      await state.storage.put("alarm:task", { type: "qr_expiry", sessionId });
      await state.storage.setAlarm(Date.now() + SESSION_TIMING.QR_EXPIRY_MS);
    });
    expect(SESSION_TIMING.QR_EXPIRY_MS).toBe(60_000);
    expect(await runDurableObjectAlarm(stub(boothId))).toBe(true);
    expect((await getSessionRow(sessionId))?.status).toBe("expired");
    expect(await autoVouchers(sessionId)).toHaveLength(0);
  });

  it("paid tanpa capture:start 3 menit -> abandoned_paid + voucher auto-abandoned, booth bebas", async () => {
    const { boothId, sessionId } = await setup("payment", 30000);
    const before = Date.now();
    expect(await stub(boothId).markPaid(boothId, sessionId)).toBe(true);

    const a = await alarmState(boothId);
    expect(a.task).toEqual({ type: "paid_timeout", sessionId });
    expect(a.at! - before).toBeGreaterThanOrEqual(SESSION_TIMING.PAID_START_TIMEOUT_MS - 50);
    expect(a.at! - before).toBeLessThan(SESSION_TIMING.PAID_START_TIMEOUT_MS + 5000);

    expect(await runDurableObjectAlarm(stub(boothId))).toBe(true);
    expect((await getSessionRow(sessionId))?.status).toBe("abandoned_paid");
    const v = await autoVouchers(sessionId);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ value: 30000, status: "active", source: "auto-abandoned" });

    // Booth bebas: sesi baru tidak kena BOOTH_BUSY.
    const k = await openKiosk(boothId);
    const r = await k.request(SocketEvents.CONFIRM_AND_PAY, { boothId, method: "voucher" });
    k.close();
    expect(r.ok).toBe(true);
  });

  it("alarm diulang (paid_timeout dua kali) tetap satu voucher", async () => {
    const { boothId, sessionId } = await setup("payment");
    await stub(boothId).markPaid(boothId, sessionId);
    await runDurableObjectAlarm(stub(boothId));
    await runInDurableObject(stub(boothId), async (_i, state) => {
      await state.storage.put("alarm:task", { type: "paid_timeout", sessionId });
      await state.storage.setAlarm(Date.now() + 1000);
    });
    await runDurableObjectAlarm(stub(boothId));
    expect(await autoVouchers(sessionId)).toHaveLength(1);
  });

  it("capture:start sekali: paid -> capturing + alarm 10 menit; ulang tidak memperpanjang", async () => {
    const { boothId, sessionId } = await setup("payment");
    await stub(boothId).markPaid(boothId, sessionId);
    const k = await openKiosk(boothId);
    const r1 = await k.request(SocketEvents.START_CAPTURE, { sessionId, photoIndex: 1 });
    expect(r1.ok).toBe(true);
    expect((await getSessionRow(sessionId))?.status).toBe("capturing");
    const a1 = await alarmState(boothId);
    expect(a1.task).toEqual({ type: "capture_timeout", sessionId });

    const r2 = await k.request(SocketEvents.START_CAPTURE, { sessionId, photoIndex: 2 });
    k.close();
    expect(r2.ok).toBe(true);
    const a2 = await alarmState(boothId);
    expect(a2.at).toBe(a1.at);
  });

  it("capturing 10 menit tanpa markDone -> stale + voucher auto-abandoned", async () => {
    const { boothId, sessionId } = await setup("payment");
    await stub(boothId).markPaid(boothId, sessionId);
    const k = await openKiosk(boothId);
    await k.request(SocketEvents.START_CAPTURE, { sessionId });
    k.close();

    expect(await runDurableObjectAlarm(stub(boothId))).toBe(true);
    expect((await getSessionRow(sessionId))?.status).toBe("stale");
    const v = await autoVouchers(sessionId);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ source: "auto-abandoned", status: "active" });
  });

  it("session:create saat paid -> BOOTH_BUSY dengan releasesAt = alarm paid_timeout", async () => {
    const { boothId, sessionId } = await setup("payment");
    await stub(boothId).markPaid(boothId, sessionId);
    const { at } = await alarmState(boothId);

    const k = await openKiosk(boothId);
    const r = (await k.request(SocketEvents.CONFIRM_AND_PAY, { boothId, method: "voucher" })) as Record<string, unknown>;
    k.close();
    expect(r.ok).toBe(false);
    expect(r.code).toBe("BOOTH_BUSY");
    expect(r.releasesAt).toBe(new Date(at!).toISOString());
    expect((await getSessionRow(sessionId))?.status).toBe("paid");
  });

  it("kiosk CANCEL untuk sesi berbayar ditolak (uang tidak boleh hilang lewat tap batal)", async () => {
    const { boothId, sessionId } = await setup("payment");
    await stub(boothId).markPaid(boothId, sessionId);
    const k = await openKiosk(boothId);
    const r = (await k.request(SocketEvents.CANCEL, { sessionId })) as Record<string, unknown>;
    k.close();
    expect(r.ok).toBe(false);
    expect(r.code).toBe("BOOTH_BUSY");
    expect((await getSessionRow(sessionId))?.status).toBe("paid");
  });

  it("PAYMENT_PAID membawa downloadToken", async () => {
    const { boothId, sessionId } = await setup("payment");
    const k = await openKiosk(boothId);
    await k.waitPush(SocketEvents.KIOSK_READY);
    await stub(boothId).markPaid(boothId, sessionId);
    const push = await k.waitPush(SocketEvents.PAYMENT_PAID);
    k.close();
    const row = await getSessionRow(sessionId);
    expect((push.data as Record<string, unknown>).downloadToken).toBe(row?.download_token);
  });
});

describe("U5 markDone", () => {
  async function capturing() {
    const s = await setup("payment");
    await stub(s.boothId).markPaid(s.boothId, s.sessionId);
    const k = await openKiosk(s.boothId);
    await k.request(SocketEvents.START_CAPTURE, { sessionId: s.sessionId });
    k.close();
    return s;
  }

  it("unggahan foto JPEG tidak mengubah status; /done -> done + alarm dibersihkan", async () => {
    const { boothId, sessionId, token } = await capturing();
    for (const n of [1, 2, 3, 4]) expect((await putPhoto(sessionId, token, n)).status).toBe(200);
    // Ulang slot 2 (antrean agent retry) tidak menggandakan baris.
    expect((await putPhoto(sessionId, token, 2)).status).toBe(200);
    expect((await getSessionRow(sessionId))?.status).toBe("capturing");
    const photos = await env.DB.prepare("SELECT r2_key, sort_order FROM photos WHERE session_id = ? ORDER BY sort_order")
      .bind(sessionId)
      .all<{ r2_key: string; sort_order: number }>();
    expect(photos.results.map((p) => p.sort_order)).toEqual([1, 2, 3, 4]);
    expect(photos.results[0]!.r2_key).toMatch(/photo-1\.jpg$/);

    const res = await bridgePost(`/session/${sessionId}/done`, token);
    expect(res.status).toBe(200);
    expect((await getSessionRow(sessionId))?.status).toBe("done");
    expect((await alarmState(boothId)).task).toBeUndefined();

    // Idempoten.
    expect((await bridgePost(`/session/${sessionId}/done`, token)).status).toBe(200);
  });

  it("sortOrder di luar 1..4 ditolak 400", async () => {
    const { sessionId, token } = await capturing();
    expect((await putPhoto(sessionId, token, 0)).status).toBe(400);
    expect((await putPhoto(sessionId, token, 5)).status).toBe(400);
    expect((await putPhoto(sessionId, token, "x")).status).toBe(400);
  });

  it("/done dari stale + voucher belum terpakai -> done, voucher disabled late-done", async () => {
    const { boothId, sessionId, token } = await capturing();
    await runDurableObjectAlarm(stub(boothId));
    expect((await getSessionRow(sessionId))?.status).toBe("stale");

    const res = await bridgePost(`/session/${sessionId}/done`, token);
    expect(res.status).toBe(200);
    expect((await getSessionRow(sessionId))?.status).toBe("done");
    const [v] = await autoVouchers(sessionId);
    expect(v!.status).toBe("disabled");
    expect(JSON.parse(String(v!.metadata))).toMatchObject({ disabledReason: "late-done" });
  });

  it("/done dari stale + voucher sudah terpakai -> 409 SESSION_STALE, status tetap stale", async () => {
    const { boothId, sessionId, token } = await capturing();
    await runDurableObjectAlarm(stub(boothId));
    const [v] = await autoVouchers(sessionId);
    await env.DB.prepare("UPDATE vouchers SET used_count = 1, status = 'used' WHERE id = ?").bind(v!.id).run();

    const res = await bridgePost(`/session/${sessionId}/done`, token);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "SESSION_STALE" });
    expect((await getSessionRow(sessionId))?.status).toBe("stale");
  });

  it("/done dari paid (capture belum mulai) -> 409 INVALID_STATE", async () => {
    const { boothId, sessionId, token } = await setup("payment");
    await stub(boothId).markPaid(boothId, sessionId);
    const res = await bridgePost(`/session/${sessionId}/done`, token);
    expect(res.status).toBe(409);
    expect((await getSessionRow(sessionId))?.status).toBe("paid");
  });

  it("/done dengan token booth lain -> 401", async () => {
    const { sessionId } = await capturing();
    const other = await setup("payment");
    expect((await bridgePost(`/session/${sessionId}/done`, other.token)).status).toBe(401);
  });

  it("cancel-voucher staf: capturing -> cancelled + voucher staff-cancel, idempoten", async () => {
    const { sessionId, token } = await capturing();
    const r1 = await bridgePost(`/session/${sessionId}/cancel-voucher`, token, { staff: "barista-1" });
    expect(r1.status).toBe(200);
    const d1 = ((await r1.json()) as { data: { code: string; created: boolean } }).data;
    expect(d1.created).toBe(true);
    const r2 = await bridgePost(`/session/${sessionId}/cancel-voucher`, token);
    const d2 = ((await r2.json()) as { data: { code: string; created: boolean } }).data;
    expect(d2).toMatchObject({ code: d1.code, created: false });
    expect((await getSessionRow(sessionId))?.status).toBe("cancelled");
    const v = await autoVouchers(sessionId);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ source: "staff-cancel", value: 30000 });
  });

  it("cancel-voucher untuk sesi belum bayar -> 409", async () => {
    const { sessionId, token } = await setup("payment");
    expect((await bridgePost(`/session/${sessionId}/cancel-voucher`, token)).status).toBe(409);
  });

  it("print-status disimpan di metadata.print, status sesi tidak berubah", async () => {
    const { sessionId, token } = await capturing();
    await bridgePost(`/session/${sessionId}/done`, token);
    expect((await bridgePost(`/session/${sessionId}/print-status`, token, { sheet: 1, state: "done", cupsJobId: 12 })).status).toBe(200);
    expect((await bridgePost(`/session/${sessionId}/print-status`, token, { sheet: 2, state: "failed", error: "paper jam" })).status).toBe(200);
    expect((await bridgePost(`/session/${sessionId}/print-status`, token, { sheet: 2, state: "bogus" })).status).toBe(400);
    const row = await getSessionRow(sessionId);
    expect(row?.status).toBe("done");
    const meta = JSON.parse(String(row?.metadata));
    expect(meta.print.state).toBe("failed");
    expect(meta.print.sheets["1"]).toMatchObject({ state: "done", cupsJobId: 12 });
    expect(meta.print.sheets["2"]).toMatchObject({ state: "failed", error: "paper jam" });
  });

  it("heartbeat menerima counters {paper, ink}", async () => {
    const { boothId, token } = await setup("payment");
    const res = await bridgePost("/heartbeat", token, { boothId, counters: { paper: 36, ink: 40 } });
    expect(res.status).toBe(200);
    const b = await env.DB.prepare("SELECT metadata FROM booths WHERE id = ?").bind(boothId).first<{ metadata: string }>();
    expect(JSON.parse(b!.metadata).counters).toEqual({ paper: 36, ink: 40 });
  });

  it("/ws/bridge sudah tidak ada", async () => {
    const { boothId, token } = await setup("payment");
    const res = await SELF.fetch(`https://capture.test/ws/bridge/${boothId}`, {
      headers: { Upgrade: "websocket", authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
