import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_FRAME_ASSET_MIME,
  ALLOWED_IMAGE_MIME,
  DEFAULT_LAYOUT_V2,
  imageExtForMime,
  isLayoutV2,
  validateLayoutV2,
  type KioskBootData,
} from "@capture/shared";
import { validateUpload } from "@/lib/storage";
import { seedBooth, seedFrame } from "./helpers";

describe("kontrak shared: layout v2", () => {
  it("default layout v2 valid (1200x1800, 4 slot 3:2)", () => {
    expect(validateLayoutV2(DEFAULT_LAYOUT_V2)).toEqual([]);
  });

  it("menolak layout v1, slot != 4, keluar kanvas, tumpang tindih, rasio salah", () => {
    expect(isLayoutV2({ canvasWidth: 1800, canvasHeight: 1200, photoSlots: [] })).toBe(false);
    const base = structuredClone(DEFAULT_LAYOUT_V2);
    expect(validateLayoutV2({ ...base, slots: base.slots.slice(0, 3) })).toContain("slots harus tepat 4");
    const out = structuredClone(base);
    out.slots[3] = { x: 900, y: 1600, w: 525, h: 350 };
    expect(validateLayoutV2(out).join()).toMatch(/keluar kanvas/);
    const overlap = structuredClone(base);
    overlap.slots[1] = { x: 100, y: 130, w: 525, h: 350 };
    expect(validateLayoutV2(overlap).join()).toMatch(/tumpang tindih/);
    const ratio = structuredClone(base);
    ratio.slots[0] = { x: 60, y: 120, w: 500, h: 400 };
    expect(validateLayoutV2(ratio).join()).toMatch(/rasio/);
    expect(validateLayoutV2({ ...base, slots: base.slots.map((s) => ({ ...s, x: s.x + 0.5 })) }).join()).toMatch(
      /bilangan bulat/,
    );
  });
});

describe("kontrak shared: MIME", () => {
  it("unggahan sesi terima JPEG dari agent; aset frame tetap PNG saja", () => {
    expect(ALLOWED_IMAGE_MIME).toContain("image/jpeg");
    expect(ALLOWED_FRAME_ASSET_MIME).toEqual(["image/png"]);
    expect(validateUpload({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validateUpload({ type: "image/webp", size: 1000 })).toBe("invalid_mime");
    expect(validateUpload({ type: "image/jpeg", size: 6 * 1024 * 1024 })).toBe("too_large");
    expect(validateUpload({ type: "image/jpeg; q=1", size: 1000 })).toBeNull();
    expect(validateUpload({ type: "image/jpeg", size: 1000 }, "frame-asset")).toBe("invalid_mime");
    expect(validateUpload({ type: "image/png", size: 1000 }, "frame-asset")).toBeNull();
  });

  it("ekstensi kunci R2 ikut content-type", () => {
    expect(imageExtForMime("image/jpeg")).toBe("jpg");
    expect(imageExtForMime("image/png")).toBe("png");
  });
});

describe("GET /api/kiosk/boot", () => {
  it("hanya kirim frame layout v2, lengkap dengan layoutJson; tanpa useMockBridge", async () => {
    const boothId = await seedBooth();
    const v2 = await seedFrame({ boothId });
    await seedFrame({
      boothId,
      layout: { canvasWidth: 1800, canvasHeight: 1200, photoSlots: [], stripCount: 2 },
    });
    const res = await SELF.fetch(`https://capture.test/api/kiosk/boot?boothId=${boothId}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: KioskBootData };
    expect(data.frames.map((f) => f.id)).toEqual([v2]);
    expect(data.frames[0]!.layoutJson.version).toBe(2);
    expect("useMockBridge" in data.booth).toBe(false);
  });

  it("booth nonaktif 403, booth tak dikenal 404", async () => {
    const off = await seedBooth({ id: "BTH-OFF", isActive: false });
    expect((await SELF.fetch(`https://capture.test/api/kiosk/boot?boothId=${off}`)).status).toBe(403);
    expect((await SELF.fetch("https://capture.test/api/kiosk/boot?boothId=NOPE")).status).toBe(404);
  });
});
