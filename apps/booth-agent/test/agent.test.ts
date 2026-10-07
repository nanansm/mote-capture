import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_V2 } from "@capture/shared";
import { AgentError, BoothAgent } from "../src/agent.js";
import { closeDb, kvSet, openDb, type Db } from "../src/db.js";
import { MockCamera } from "../src/drivers/camera.js";
import { MockPrinter } from "../src/drivers/printer.js";
import { FrameCache } from "../src/frames.js";
import { Hub } from "../src/hub.js";
import { composeStrip } from "../src/compose.js";
import type { AgentConfig } from "../src/config.js";
import type { Cloud, CloudResult } from "../src/cloud.js";

const silent = { info() {}, warn() {}, error() {} };

/** Cloud palsu: status per jenis panggilan bisa diatur, semua panggilan dicatat. */
class FakeCloud {
  calls: string[] = [];
  doneStatus = 200;
  uploadStatus = 200;
  ok = (s: number): Promise<CloudResult> => Promise.resolve({ status: s, body: s === 409 ? { error: "SESSION_CANCELLED" } : {} });
  boot = async () => ({ status: 0, body: null, error: "offline" });
  done = async (id: string) => (this.calls.push(`done ${id}`), this.ok(this.doneStatus));
  uploadComposite = async (id: string) => (this.calls.push(`composite ${id}`), this.ok(this.uploadStatus));
  uploadPhoto = async (id: string, slot: number) => (this.calls.push(`photo ${id} ${slot}`), this.ok(this.uploadStatus));
  printStatus = async (id: string) => (this.calls.push(`print ${id}`), this.ok(200));
  cancelVoucher = async (id: string) => (this.calls.push(`cancel ${id}`), { status: 200, body: { data: { code: "ABC123", voucherId: "v1" } } });
  heartbeat = async () => this.ok(200);
  download = async () => Buffer.alloc(0);
}

let dir: string;
let db: Db;
let cam: MockCamera;
let prn: MockPrinter;
let cloud: FakeCloud;
let agent: BoothAgent;
let hub: Hub;
let events: { type: string; [k: string]: unknown }[];

async function boot() {
  const cfg = { dataDir: dir, version: "test", boothId: "B" } as AgentConfig;
  const frames = new FrameCache(dir, cloud as unknown as Cloud, "http://cdn", silent);
  await frames.init();
  agent = new BoothAgent(cfg, db, cam, prn, cloud as unknown as Cloud, frames, hub, silent);
  await agent.start();
}

const until = async (fn: () => boolean, ms = 5000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function shoot(id: string, slot: number, retake = false) {
  const before = events.length;
  agent.shoot(id, slot, retake);
  await until(() => events.slice(before).some((e) => e.type === "photo.ready" || e.type === "photo.failed"));
  return events.slice(before).find((e) => e.type === "photo.ready" || e.type === "photo.failed")!;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ba-test-"));
  db = openDb(dir);
  cam = new MockCamera();
  cam.shutterDelayMs = 5;
  cam.downloadDelayMs = 5;
  prn = new MockPrinter();
  prn.printMs = 30;
  cloud = new FakeCloud();
  hub = new Hub();
  events = [];
  hub.add({ readyState: 1, send: (d: string) => events.push(JSON.parse(d)) });
  await boot();
});

afterEach(async () => {
  await agent.stop();
  closeDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("sesi + kamera", () => {
  it("4 foto + 1 retake, retake kedua ditolak, compose idempoten", async () => {
    await agent.startSession("S1", null);
    for (let s = 1; s <= 4; s++) expect((await shoot("S1", s)).type).toBe("photo.ready");
    expect((await shoot("S1", 2, true)).type).toBe("photo.ready");
    expect(() => agent.shoot("S1", 2, true)).toThrow(/RETAKE_USED/);
    const url = await agent.compose("S1");
    expect(url).toBe("/files/sessions/S1/composite.jpg");
    expect(await agent.compose("S1")).toBe(url);
    const meta = await sharp(path.join(dir, "sessions/S1/composite.jpg")).metadata();
    expect([meta.width, meta.height]).toEqual([DEFAULT_LAYOUT_V2.canvasWidth, DEFAULT_LAYOUT_V2.canvasHeight]);
  });

  it("kamera single-flight: capture kedua saat jepret = CAMERA_BUSY", async () => {
    cam.shutterDelayMs = 200;
    await agent.startSession("S1", null);
    agent.shoot("S1", 1, false);
    expect(() => agent.shoot("S1", 2, false)).toThrow(/CAMERA_BUSY/);
  });

  it("jepret gagal tidak menimpa foto lama (retake gagal = foto lama aman)", async () => {
    await agent.startSession("S1", null);
    await shoot("S1", 1);
    const before = fs.readFileSync(path.join(dir, "sessions/S1/raw-1.jpg"));
    cam.failNextCapture();
    expect((await shoot("S1", 1, true)).type).toBe("photo.failed");
    expect(fs.readFileSync(path.join(dir, "sessions/S1/raw-1.jpg")).equals(before)).toBe(true);
    expect(agent.activeSession()?.retakeUsed[0]).toBe(false);
  });

  it("kamera offline: startSession ditolak CAMERA_OFFLINE", async () => {
    cam.setConnected(false);
    await expect(agent.startSession("S1", null)).rejects.toMatchObject({ code: "CAMERA_OFFLINE" });
  });

  it("compose sebelum 4 foto = PHOTOS_INCOMPLETE", async () => {
    await agent.startSession("S1", null);
    await shoot("S1", 1);
    await expect(agent.compose("S1")).rejects.toMatchObject({ code: "PHOTOS_INCOMPLETE" });
  });

  it("path file sesi menolak traversal", () => {
    expect(agent.resolveFile("../etc", "composite.jpg")).toBeNull();
    expect(agent.resolveFile("S1", "../../agent.db")).toBeNull();
  });
});

describe("antrean + cetak", () => {
  async function fullSession(id: string) {
    await agent.startSession(id, null);
    for (let s = 1; s <= 4; s++) await shoot(id, s);
    await agent.compose(id);
  }

  it("done -> 2 lembar cetak, upload composite + 4 foto, penghitung -2", async () => {
    kvSet(db, "x", null);
    db.prepare("UPDATE counters SET value = 36").run();
    await fullSession("S1");
    await until(() => agent.queue.counts().pending === 0 && prn.submitted.length === 2);
    await until(() => agent.counters().paper === 34);
    expect(cloud.calls.filter((c) => c.startsWith("photo"))).toHaveLength(4);
    expect(cloud.calls).toContain("composite S1");
    expect(cloud.calls[0]).toBe("done S1");
  });

  it("done ditolak 409 (voucher pengganti terpakai): nol cetak, nol upload", async () => {
    cloud.doneStatus = 409;
    await fullSession("S1");
    await until(() => cloud.calls.includes("done S1"));
    await new Promise((r) => setTimeout(r, 200));
    expect(prn.submitted).toHaveLength(0);
    expect(cloud.calls.filter((c) => c.startsWith("photo") || c.startsWith("composite"))).toHaveLength(0);
    expect(agent.queue.counts()).toEqual({ pending: 0, failed: 0 });
  });

  it("upload gagal terus -> tetap di antrean (backoff), staf retry setelah failed", async () => {
    cloud.uploadStatus = 503;
    await fullSession("S1");
    await until(() => agent.queue.counts().pending === 5 && cloud.calls.includes("composite S1"));
    db.prepare("UPDATE upload_queue SET state = 'failed' WHERE kind IN ('photo','composite')").run();
    cloud.uploadStatus = 200;
    expect(agent.queue.retryFailed()).toBe(5);
    await until(() => agent.queue.counts().pending === 0 && agent.queue.counts().failed === 0);
  });
});

describe("pemulihan", () => {
  it("restart proses (boot_id sama): sesi lanjut dari nextSlot", async () => {
    await agent.startSession("S1", null);
    await shoot("S1", 1);
    await shoot("S1", 2);
    await agent.stop();
    await boot();
    expect(agent.activeSession()).toMatchObject({ id: "S1", nextSlot: 3 });
  });

  it("mesin reboot (boot_id beda): sesi tanpa composite ditinggalkan", async () => {
    await agent.startSession("S1", null);
    await shoot("S1", 1);
    await agent.stop();
    kvSet(db, "bootId", "boot-lama-berbeda");
    await boot();
    expect(agent.activeSession()).toBeNull();
    const row = db.prepare("SELECT phase FROM sessions_local WHERE id = 'S1'").get() as { phase: string };
    expect(row.phase).toBe("abandoned");
  });

  it("crash setelah done sukses sebelum lp: cetak disubmit saat start, tidak dobel", async () => {
    await agent.startSession("S1", null);
    for (let s = 1; s <= 4; s++) await shoot("S1", s);
    await agent.compose("S1");
    await until(() => prn.submitted.length === 2);
    await agent.stop();
    db.prepare("DELETE FROM print_jobs").run(); // simulasi crash sebelum baris cetak tercatat
    await boot();
    await until(() => prn.submitted.length === 4);
    await agent.stop();
    await boot();
    await new Promise((r) => setTimeout(r, 100));
    expect(prn.submitted).toHaveLength(4);
  });
});

describe("PIN staf", () => {
  beforeEach(async () => kvSet(db, "staffPinHash", await BoothAgent.hashPin("1234")));

  it("PIN benar = token, salah 5x = terkunci bertingkat", async () => {
    const ok = await agent.staffLogin("1234");
    expect(agent.staffOk(ok.token)).toBe(true);
    for (let i = 0; i < 4; i++) await expect(agent.staffLogin("0000")).rejects.toMatchObject({ code: "WRONG_PIN" });
    await expect(agent.staffLogin("0000")).rejects.toMatchObject({ code: "LOCKED" });
    // PIN benar pun ditolak selama terkunci.
    await expect(agent.staffLogin("1234")).rejects.toMatchObject({ code: "LOCKED" });
  });

  it("PIN belum di-set = PIN_NOT_SET", async () => {
    kvSet(db, "staffPinHash", null);
    await expect(agent.staffLogin("1234")).rejects.toBeInstanceOf(AgentError);
  });
});

describe("compose", () => {
  it("artwork PNG ditempel di atas foto, ukuran kanvas sesuai layout", async () => {
    const photos: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = path.join(dir, `p${i}.jpg`);
      await sharp({ create: { width: 600, height: 400, channels: 3, background: "#1A3A2A" } }).jpeg().toFile(p);
      photos.push(p);
    }
    const { canvasWidth: width, canvasHeight: height } = DEFAULT_LAYOUT_V2;
    const art = path.join(dir, "art.png");
    await sharp({ create: { width, height, channels: 4, background: { r: 254, g: 123, b: 0, alpha: 1 } } }).png().toFile(art);
    const out = path.join(dir, "out.jpg");
    await composeStrip({ layout: DEFAULT_LAYOUT_V2, photos, artworkPath: art, outPath: out });
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    // Artwork opak penuh menutup foto: piksel tengah = oranye.
    const mid = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3;
    expect(data[mid]).toBeGreaterThan(240);
    expect(data[mid + 1]).toBeGreaterThan(100);
    expect(data[mid + 1]).toBeLessThan(140);
  });
});
