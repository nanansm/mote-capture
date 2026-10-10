import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SocketEvents, type KioskBootData } from "@capture/shared";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getSessionRow, linkFrame, seedBooth, seedFrame, uid } from "./helpers";
import { openKiosk } from "./ws";

// Frame & harga per booth (migrasi 0004): booth -> frame, harga di booth_frames.

async function admin(path: string, method: string, body?: unknown) {
  const t = await createSessionToken("admin@test.local", env.BETTER_AUTH_SECRET!);
  return SELF.fetch(`https://capture.test/api${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE_NAME}=${t}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function boot(boothId: string) {
  const res = await SELF.fetch(`https://capture.test/api/kiosk/boot?boothId=${boothId}`);
  return ((await res.json()) as { data: KioskBootData }).data;
}

async function pay(boothId: string, frameId: string) {
  const k = await openKiosk(boothId);
  const r = (await k.request(SocketEvents.CONFIRM_AND_PAY, { boothId, frameId, method: "voucher" })) as {
    ok: boolean;
    error?: string;
    data?: { sessionId: string };
  };
  k.close();
  return r;
}

type BoothFrame = {
  frameId: string;
  price: number;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  frame: { id: string; name: string; previewUrl: string | null; isActive: boolean };
};

const listOf = async (boothId: string) =>
  ((await (await admin(`/booths/${boothId}/frames`, "GET")).json()) as { data: BoothFrame[] }).data;

describe("frame sama, harga beda per booth", () => {
  it("boot kiosk & nominal sesi ikut harga booth", async () => {
    const b1 = await seedBooth({ id: uid("BTH") });
    const b2 = await seedBooth({ id: uid("BTH") });
    const f = await seedFrame();
    await linkFrame(b1, f, { price: 30000 });
    await linkFrame(b2, f, { price: 25000 });

    expect((await boot(b1)).frames.find((x) => x.id === f)?.price).toBe(30000);
    expect((await boot(b2)).frames.find((x) => x.id === f)?.price).toBe(25000);

    const r2 = await pay(b2, f);
    expect(r2.ok).toBe(true);
    expect((await getSessionRow(r2.data!.sessionId))?.amount).toBe(25000);
  });

  it("frame tidak terpasang di booth: tidak tampil & sesi ditolak", async () => {
    const b1 = await seedBooth({ id: uid("BTH") });
    const b2 = await seedBooth({ id: uid("BTH") });
    const f = await seedFrame({ boothId: b1 });
    expect((await boot(b2)).frames.map((x) => x.id)).not.toContain(f);
    const r = await pay(b2, f);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/tidak dipasang/);
  });

  it("dimatikan di booth: tersembunyi di booth itu saja", async () => {
    const b1 = await seedBooth({ id: uid("BTH") });
    const b2 = await seedBooth({ id: uid("BTH") });
    const f = await seedFrame();
    await linkFrame(b1, f, { isActive: false });
    await linkFrame(b2, f);
    expect((await boot(b1)).frames.map((x) => x.id)).not.toContain(f);
    expect((await boot(b2)).frames.map((x) => x.id)).toContain(f);
    expect((await pay(b1, f)).ok).toBe(false);
  });

  it("frame diarsipkan global: hilang dari semua booth", async () => {
    const b1 = await seedBooth({ id: uid("BTH") });
    const f = await seedFrame({ boothId: b1, isActive: false });
    expect((await boot(b1)).frames.map((x) => x.id)).not.toContain(f);
  });

  it("urutan & frame utama per booth", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    const f1 = await seedFrame();
    const f2 = await seedFrame();
    await linkFrame(b, f1, { sortOrder: 1 });
    await linkFrame(b, f2, { sortOrder: 0, isDefault: true });
    const frames = (await boot(b)).frames;
    expect(frames.map((x) => x.id)).toEqual([f2, f1]);
    expect(frames[0]!.isDefault).toBe(true);
    expect(frames[1]!.isDefault).toBe(false);
  });
});

describe("API /api/booths/:id/frames", () => {
  it("tanpa login: 401", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    expect((await SELF.fetch(`https://capture.test/api/booths/${b}/frames`)).status).toBe(401);
  });

  it("pasang, ubah harga, lepas", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    const f = await seedFrame();
    const put = await admin(`/booths/${b}/frames/${f}`, "PUT", { price: 35000 });
    expect(put.status).toBe(200);
    let list = await listOf(b);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ frameId: f, price: 35000, isActive: true });
    expect(list[0]!.frame.id).toBe(f);
    expect(list[0]!.frame).toMatchObject({ layoutOk: true });

    expect((await admin(`/booths/${b}/frames/${f}`, "PUT", { price: 20000, isActive: false })).status).toBe(200);
    list = await listOf(b);
    expect(list[0]).toMatchObject({ price: 20000, isActive: false });

    expect((await admin(`/booths/${b}/frames/${f}`, "DELETE")).status).toBe(200);
    expect(await listOf(b)).toHaveLength(0);
    // Frame di library tetap ada.
    expect((await admin(`/frames/${f}`, "GET")).status).toBe(200);
  });

  it("frame layout lama (v1) ditandai layoutOk=false", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    const f = await seedFrame({ layout: { version: 1, slots: [] } });
    await admin(`/booths/${b}/frames/${f}`, "PUT", { price: 30000 });
    const list = await listOf(b);
    expect(list[0]!.frame).toMatchObject({ layoutOk: false });
  });

  it("pasang baru tanpa harga: pakai harga default booth", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    const f = await seedFrame({ price: 99000 });
    expect((await admin(`/booths/${b}/frames/${f}`, "PUT", {})).status).toBe(200);
    expect((await listOf(b))[0]!.price).toBe(30000);
  });

  it("harga di bawah Rp1.000 / bukan angka bulat: 400", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    const f = await seedFrame();
    expect((await admin(`/booths/${b}/frames/${f}`, "PUT", { price: 500 })).status).toBe(400);
    expect((await admin(`/booths/${b}/frames/${f}`, "PUT", { price: 1500.5 })).status).toBe(400);
  });

  it("booth / frame tidak ada: 404", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    const f = await seedFrame();
    expect((await admin(`/booths/NOPE/frames/${f}`, "PUT", { price: 30000 })).status).toBe(404);
    expect((await admin(`/booths/${b}/frames/NOPE`, "PUT", { price: 30000 })).status).toBe(404);
    expect((await admin(`/booths/${b}/frames/${f}`, "DELETE")).status).toBe(404);
  });

  it("set utama: hanya satu frame utama per booth, booth lain tak tersentuh", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    const other = await seedBooth({ id: uid("BTH") });
    const f1 = await seedFrame();
    const f2 = await seedFrame();
    await linkFrame(b, f1, { isDefault: true });
    await linkFrame(b, f2);
    await linkFrame(other, f1, { isDefault: true });
    expect((await admin(`/booths/${b}/frames/${f2}`, "PUT", { isDefault: true })).status).toBe(200);
    const list = await listOf(b);
    expect(list.filter((x) => x.isDefault).map((x) => x.frameId)).toEqual([f2]);
    expect((await listOf(other))[0]!.isDefault).toBe(true);
  });

  it("reorder: urutan tersimpan, id asing ditolak", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    const [f1, f2, f3] = [await seedFrame(), await seedFrame(), await seedFrame()];
    for (const f of [f1, f2, f3]) await linkFrame(b, f);
    expect((await admin(`/booths/${b}/frames/reorder`, "POST", { frameIds: [f3, f1, f2] })).status).toBe(200);
    expect((await listOf(b)).map((x) => x.frameId)).toEqual([f3, f1, f2]);
    expect((await admin(`/booths/${b}/frames/reorder`, "POST", { frameIds: [f1, "NOPE"] })).status).toBe(400);
  });
});

describe("library frame", () => {
  const base = (over: Record<string, unknown> = {}) => ({
    name: "Frame Library",
    tier: "regular",
    price: 30000,
    backgroundKey: "backgrounds/uji.png",
    isActive: true,
    isDefault: false,
    sortOrder: 0,
    ...over,
  });

  it("buat frame dari booth: langsung terpasang dengan harga itu", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    const res = await admin("/frames", "POST", base({ boothId: b, price: 27000 }));
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string } };
    const list = await listOf(b);
    expect(list.map((x) => x.frameId)).toEqual([data.id]);
    expect(list[0]!.price).toBe(27000);
  });

  it("frame pertama di booth otomatis jadi utama", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    await admin("/frames", "POST", base({ boothId: b }));
    expect((await listOf(b))[0]!.isDefault).toBe(true);
  });

  it("GET /frames menyertakan booth pemakai + harganya", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    const f = await seedFrame();
    await linkFrame(b, f, { price: 22000 });
    const { data } = (await (await admin("/frames", "GET")).json()) as {
      data: Array<{ id: string; booths: Array<{ id: string; name: string; price: number }> }>;
    };
    expect(data.find((x) => x.id === f)?.booths).toEqual([{ id: b, name: `Booth ${b}`, price: 22000 }]);
  });

  it("hapus frame yang masih terpasang: 409 menyebut booth", async () => {
    const b = await seedBooth({ id: uid("BTH") });
    const f = await seedFrame({ boothId: b });
    const res = await admin(`/frames/${f}`, "DELETE");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain(`Booth ${b}`);
    await admin(`/booths/${b}/frames/${f}`, "DELETE");
    expect((await admin(`/frames/${f}`, "DELETE")).status).toBe(200);
  });

  it("booth baru otomatis tidak punya frame (pasang manual)", async () => {
    await seedFrame();
    const res = await admin("/booths", "POST", { name: "Booth Baru", defaultPrice: 30000, isActive: true });
    const { data } = (await res.json()) as { data: { id: string } };
    expect(await listOf(data.id)).toHaveLength(0);
  });
});
