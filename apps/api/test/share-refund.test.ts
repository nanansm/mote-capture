import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getSessionRow, seedBooth, seedSession, uid } from "./helpers";

// U6 + U7 (PRD bagian 13).

async function seedPhoto(sessionId: string, isFinal: boolean, sortOrder = 0) {
  await env.DB.prepare("INSERT INTO photos (id, session_id, r2_key, is_final, sort_order) VALUES (?, ?, ?, ?, ?)")
    .bind(uid("PHO"), sessionId, `sessions/${sessionId}/${isFinal ? "composite" : `photo-${sortOrder}`}.jpg`, isFinal ? 1 : 0, sortOrder)
    .run();
}

const getShare = (token: string) => SELF.fetch(`https://capture.test/api/share/${token}`);

async function adminCookie() {
  const t = await createSessionToken("admin@test.local", env.BETTER_AUTH_SECRET!);
  return `${SESSION_COOKIE_NAME}=${t}`;
}

const refund = async (sessionId: string, body: Record<string, unknown>) =>
  SELF.fetch(`https://capture.test/api/session/${sessionId}/refund`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await adminCookie() },
    body: JSON.stringify(body),
  });

const refundLogs = (sessionId: string) =>
  env.DB.prepare("SELECT payload FROM payment_logs WHERE session_id = ? AND event_type = 'refund_manual'")
    .bind(sessionId)
    .all<{ payload: string }>()
    .then((r) => r.results);

describe("U6 share saat composite belum di R2", () => {
  it("done tanpa composite: 200 state uploading", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const token = uid("tok");
    const sessionId = await seedSession({ boothId, status: "done", downloadToken: token });
    await seedPhoto(sessionId, false, 1);

    const res = await getShare(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "uploading" });
  });

  it("done dengan composite: 200 state ready + foto", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const token = uid("tok");
    const sessionId = await seedSession({ boothId, status: "done", downloadToken: token });
    await seedPhoto(sessionId, true);

    const res = await getShare(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; photos: unknown[] };
    expect(body.state).toBe("ready");
    expect(body.photos).toHaveLength(1);
  });

  it("belum done: tetap 425", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const token = uid("tok");
    await seedSession({ boothId, status: "capturing", downloadToken: token });
    expect((await getShare(token)).status).toBe(425);
  });
});

describe("U7 refund sesi done", () => {
  it("tercatat, status tetap done, share tetap 200", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const token = uid("tok");
    const sessionId = await seedSession({ boothId, status: "done", downloadToken: token });
    await seedPhoto(sessionId, true);

    const res = await refund(sessionId, { reasonCode: "PRINT_FAILED", reason: "kertas macet" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "done" });

    const row = await getSessionRow(sessionId);
    expect(row?.status).toBe("done");
    expect(JSON.parse(String(row?.metadata)).refund).toMatchObject({ reasonCode: "PRINT_FAILED", fromStatus: "done" });
    const logs = await refundLogs(sessionId);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]!.payload)).toMatchObject({ reasonCode: "PRINT_FAILED", amount: 30000 });

    expect((await getShare(token)).status).toBe(200);
  });

  it("refund kedua: 409, log tetap satu", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status: "done", downloadToken: uid("tok") });
    expect((await refund(sessionId, { reason: "a" })).status).toBe(200);
    expect((await refund(sessionId, { reason: "b" })).status).toBe(409);
    expect(await refundLogs(sessionId)).toHaveLength(1);
  });

  it("sesi capturing: jadi failed", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status: "capturing", paidAt: Date.now() });
    const res = await refund(sessionId, { reasonCode: "CAMERA_FAILED", reason: "kamera mati" });
    expect(res.status).toBe(200);
    expect((await getSessionRow(sessionId))?.status).toBe("failed");
  });

  it("sesi expired (belum bayar): 400, nol log", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status: "expired" });
    expect((await refund(sessionId, { reason: "x" })).status).toBe(400);
    expect(await refundLogs(sessionId)).toHaveLength(0);
  });

  it("alasan kosong / reasonCode asing: 400", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status: "done" });
    expect((await refund(sessionId, { reason: "" })).status).toBe(400);
    expect((await refund(sessionId, { reason: "x", reasonCode: "NGASAL" })).status).toBe(400);
  });

  it("tanpa cookie admin: 401", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const sessionId = await seedSession({ boothId, status: "done" });
    const res = await SELF.fetch(`https://capture.test/api/session/${sessionId}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "x" }),
    });
    expect(res.status).toBe(401);
  });
});
