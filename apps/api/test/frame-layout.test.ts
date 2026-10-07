import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_V2 } from "@capture/shared";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { seedBooth, seedFrame, uid } from "./helpers";

// PRD bagian 8 #11 + #14: frame baru wajib layout v2, boot kiosk hanya v2.

const LAYOUT_V1 = {
  canvasWidth: 1800,
  canvasHeight: 1200,
  stripCount: 2,
  cutLineX: 900,
  photoSlots: [{ stripIndex: 0, x: 65, y: 80, width: 770, height: 320, photoIndex: 0 }],
};

async function admin(path: string, method: string, body?: unknown) {
  const t = await createSessionToken("admin@test.local", env.BETTER_AUTH_SECRET!);
  return SELF.fetch(`https://capture.test/api/frames${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE_NAME}=${t}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const base = (over: Record<string, unknown> = {}) => ({
  name: "Frame Uji",
  tier: "regular",
  price: 30000,
  backgroundKey: "backgrounds/uji.png",
  isActive: true,
  isDefault: false,
  sortOrder: 0,
  ...over,
});

const layoutOf = async (id: string) =>
  JSON.parse(
    String((await env.DB.prepare("SELECT layout_json FROM frames WHERE id = ?").bind(id).first<{ layout_json: string }>())?.layout_json),
  );

describe("layout v2 di API frame", () => {
  it("tanpa layoutJson: tersimpan DEFAULT_LAYOUT_V2", async () => {
    const res = await admin("", "POST", base());
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string } };
    expect(await layoutOf(data.id)).toEqual(DEFAULT_LAYOUT_V2);
  });

  it("layout v1: 400", async () => {
    const res = await admin("", "POST", base({ layoutJson: LAYOUT_V1 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Layout tidak valid/);
  });

  it("slot tumpang tindih / rasio salah: 400", async () => {
    const slots = structuredClone(DEFAULT_LAYOUT_V2.slots);
    slots[1] = { ...slots[0] };
    expect((await admin("", "POST", base({ layoutJson: { ...DEFAULT_LAYOUT_V2, slots } }))).status).toBe(400);
    const bad = structuredClone(DEFAULT_LAYOUT_V2.slots);
    bad[0] = { x: 60, y: 120, w: 525, h: 525 };
    expect((await admin("", "POST", base({ layoutJson: { ...DEFAULT_LAYOUT_V2, slots: bad } }))).status).toBe(400);
  });

  it("PATCH frame v1 lama ke v2: tampil di boot kiosk", async () => {
    const boothId = await seedBooth({ id: uid("BTH") });
    const id = await seedFrame({ boothId, layout: LAYOUT_V1 });
    const boot = async () =>
      ((await (await SELF.fetch(`https://capture.test/api/kiosk/boot?boothId=${boothId}`)).json()) as {
        data: { frames: Array<{ id: string; layoutJson: unknown }> };
      }).data;
    expect((await boot()).frames.map((f) => f.id)).not.toContain(id);

    expect((await admin(`/${id}`, "PATCH", { layoutJson: LAYOUT_V1 })).status).toBe(400);
    expect((await admin(`/${id}`, "PATCH", { layoutJson: DEFAULT_LAYOUT_V2 })).status).toBe(200);

    const f = (await boot()).frames.find((x) => x.id === id);
    expect(f?.layoutJson).toEqual(DEFAULT_LAYOUT_V2);
  });

  it("PATCH tanpa layoutJson tidak menyentuh layout", async () => {
    const id = await seedFrame({ layout: LAYOUT_V1 });
    expect((await admin(`/${id}`, "PATCH", { name: "Ganti nama" })).status).toBe(200);
    expect(await layoutOf(id)).toEqual(LAYOUT_V1);
  });
});
