// Inti booth-agent: sesi lokal, kamera single-flight, compose, cetak,
// penghitung, PIN staf, pemulihan setelah crash / listrik padam (PRD 9-10).
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import type { AgentActiveSession, AgentHealth, PhotoSlot, StaffRecentSession } from "@capture/shared";
import type { AgentConfig } from "./config.js";
import { kvGet, kvSet, type Db, type LocalPhase, type PrintJobRow, type SessionLocalRow } from "./db.js";
import { CameraError, type CameraDriver, type CameraStatus } from "./drivers/camera.js";
import type { PrinterDriver, PrinterStatus } from "./drivers/printer.js";
import type { Cloud } from "./cloud.js";
import type { FrameCache } from "./frames.js";
import type { Hub } from "./hub.js";
import type { Logger } from "./log.js";
import { UploadQueue } from "./queue.js";
import { composeStrip, makeThumb } from "./compose.js";

export const CAPTURE_TIMEOUT_MS = 12_000;
export const PRINT_COPIES = 2;
export const LOW_THRESHOLD = 10;
export const STAFF_TOKEN_TTL_MS = 10 * 60_000;
export const PIN_MAX_WRONG = 5;
/** Kunci bertingkat: 5 menit, 15 menit, 60 menit (tebak PIN 4 digit jadi tidak praktis). */
export const PIN_LOCK_STEPS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000];
export const RETENTION_MS = 14 * 24 * 60 * 60_000;
/** Foto mentah 2000D bisa > 5 MB (batas upload Workers): diperkecil dulu. */
export const UPLOAD_MAX_EDGE = 3000;

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_RE = /^(raw-[1-4]|thumb-[1-4]|upload-[1-4]|composite)\.jpg$/;

export class AgentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

type Shots = (number | null)[];

export class BoothAgent {
  private cameraBusy = false;
  private captureAbort: AbortController | null = null;
  private activeId: string | null = null;
  private staffTokens = new Map<string, number>();
  private printPoll: NodeJS.Timeout | null = null;
  private lastPrinter: PrinterStatus = { state: "unknown", reason: null };
  readonly queue: UploadQueue;
  /** Log panggilan cloud penting (dibaca kontrol uji e2e). */
  readonly cloudLog: { method: string; path: string; status?: number; at: number }[] = [];

  constructor(
    readonly cfg: AgentConfig,
    private db: Db,
    readonly camera: CameraDriver,
    readonly printer: PrinterDriver,
    private cloud: Cloud,
    private frames: FrameCache,
    private hub: Hub,
    private log: Logger,
  ) {
    this.queue = new UploadQueue(db, cloud, hub, log, {
      onDoneOk: (id) => this.onDoneOk(id),
      onDoneRejected: (id, code) => this.onDoneRejected(id, code),
    });
  }

  // ───────────────────────── lifecycle ─────────────────────────

  private stopping = false;

  async start(): Promise<void> {
    this.stopping = false;
    await fsp.mkdir(this.sessionsDir(), { recursive: true });
    this.recover();
    this.queue.start();
    this.printPoll = setInterval(() => void this.pollPrints(), 2000);
    await this.camera.detect().catch(() => undefined);
  }

  /** Kerja latar (prepareUploads/submitPrints) ditunggu saat stop supaya DB tidak ditutup di tengah jalan. */
  private bg = new Set<Promise<unknown>>();
  private track(p: Promise<unknown>): void {
    const t = p.catch((err) => this.log.error("background_failed", { error: err instanceof Error ? err.message : String(err) }));
    this.bg.add(t);
    void t.finally(() => this.bg.delete(t));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.printPoll) clearInterval(this.printPoll);
    // Beri kamera yang sedang jepret maksimal 10 detik (PRD bagian 9 SIGTERM).
    const until = Date.now() + 10_000;
    while (this.cameraBusy && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    this.camera.abort();
    await Promise.all([...this.bg]);
    await this.queue.stop();
  }

  /**
   * Pemulihan saat start (PRD bagian 10 #13/#14). boot_id kernel sama =
   * proses agent saja yang restart -> sesi lanjut dari nextSlot. boot_id beda
   * = mesin mati (listrik/tombol power) -> sesi tanpa composite ditinggalkan,
   * DO yang menerbitkan voucher lewat alarm stale.
   */
  private recover(): void {
    const bootId = readBootId();
    const prevBoot = kvGet(this.db, "bootId");
    kvSet(this.db, "bootId", bootId);
    const machineRebooted = prevBoot !== null && bootId !== null && prevBoot !== bootId;

    const open = this.db
      .prepare("SELECT * FROM sessions_local WHERE phase IN ('capturing','reviewing','composing')")
      .all() as SessionLocalRow[];
    for (const s of open) {
      const composite = this.file(s.id, "composite.jpg");
      if (fs.existsSync(composite)) {
        this.finishLocal(s.id, "finished");
        if (!this.queue.hasPending(s.id, "done") && !s.doneOk) this.enqueueAfterCompose(s.id);
        this.log.warn("recover_composed_session", { sessionId: s.id });
      } else if (machineRebooted) {
        this.finishLocal(s.id, "abandoned");
        this.log.warn("recover_abandon_after_reboot", { sessionId: s.id });
      } else {
        // Proses restart saja: sesi kembali aktif, kiosk melanjutkan via /health.
        this.activeId = s.id;
        if (s.phase === "composing") this.setPhase(s.id, "reviewing");
        this.log.warn("recover_resume_session", { sessionId: s.id });
      }
    }
    // Sesi done yang cetakannya belum disubmit (crash di antara done dan lp).
    const unprinted = this.db
      .prepare(
        `SELECT s.id FROM sessions_local s WHERE s.doneOk = 1
           AND NOT EXISTS (SELECT 1 FROM print_jobs p WHERE p.sessionId = s.id AND p.reprint = 0)`,
      )
      .all() as { id: string }[];
    for (const u of unprinted) this.track(this.submitPrints(u.id));
    // Crash di tengah prepareUploads: job foto yang belum masuk antrean dilengkapi.
    const partial = this.db
      .prepare(
        `SELECT s.id FROM sessions_local s WHERE s.phase = 'finished'
           AND (SELECT COUNT(*) FROM upload_queue q WHERE q.sessionId = s.id AND q.kind = 'photo') < 4`,
      )
      .all() as { id: string }[];
    for (const u of partial) this.track(this.prepareUploads(u.id));
  }

  // ───────────────────────── util ─────────────────────────

  private sessionsDir(): string {
    return path.join(this.cfg.dataDir, "sessions");
  }
  private dir(id: string): string {
    return path.join(this.sessionsDir(), id);
  }
  private file(id: string, name: string): string {
    return path.join(this.dir(id), name);
  }
  private row(id: string): SessionLocalRow | null {
    return (this.db.prepare("SELECT * FROM sessions_local WHERE id = ?").get(id) as SessionLocalRow | undefined) ?? null;
  }
  private mustRow(id: string): SessionLocalRow {
    if (!SESSION_ID_RE.test(id)) throw new AgentError(400, "BAD_SESSION_ID");
    const r = this.row(id);
    if (!r) throw new AgentError(404, "NO_SESSION");
    return r;
  }
  private setPhase(id: string, phase: LocalPhase): void {
    this.db.prepare("UPDATE sessions_local SET phase = ? WHERE id = ?").run(phase, id);
  }
  private finishLocal(id: string, phase: "finished" | "abandoned" | "orphaned"): void {
    this.db.prepare("UPDATE sessions_local SET phase = ?, finishedAt = COALESCE(finishedAt, ?) WHERE id = ?").run(phase, Date.now(), id);
    if (this.activeId === id && phase !== "finished") this.activeId = null;
  }
  thumbUrl(id: string, slot: number, version: number): string {
    return `/files/sessions/${encodeURIComponent(id)}/thumb-${slot}.jpg?v=${version}`;
  }
  compositeUrl(id: string): string {
    return `/files/sessions/${encodeURIComponent(id)}/composite.jpg`;
  }

  /** Path file sesi untuk `/files/sessions/:id/:name`; null = tidak boleh/ada. */
  resolveFile(id: string, name: string): string | null {
    if (!SESSION_ID_RE.test(id) || !FILE_RE.test(name)) return null;
    const p = this.file(id, name);
    return fs.existsSync(p) ? p : null;
  }

  // ───────────────────────── status ─────────────────────────

  counters(): AgentHealth["counters"] {
    const rows = this.db.prepare("SELECT name, value FROM counters").all() as { name: string; value: number }[];
    const get = (n: string) => rows.find((r) => r.name === n)?.value ?? 0;
    const paper = get("paper");
    const ink = get("ink");
    return { paper, ink, lowPaper: paper <= LOW_THRESHOLD, lowInk: ink <= LOW_THRESHOLD };
  }

  activeSession(): AgentActiveSession | null {
    if (!this.activeId) return null;
    const r = this.row(this.activeId);
    if (!r || !["capturing", "reviewing", "composing"].includes(r.phase)) return null;
    const shots = JSON.parse(r.shots) as Shots;
    const first = shots.findIndex((v) => v === null);
    return {
      id: r.id,
      nextSlot: (first === -1 ? 4 : first + 1) as PhotoSlot,
      retakeUsed: JSON.parse(r.retakeUsed) as boolean[],
      thumbs: shots.map((v, i) => (v === null ? null : this.thumbUrl(r.id, i + 1, v))),
      phase: r.phase as AgentActiveSession["phase"],
    };
  }

  async health(): Promise<AgentHealth> {
    this.lastPrinter = await this.printer.status().catch(() => ({ state: "unknown" as const, reason: "status error" }));
    return {
      camera: this.camera.status(),
      printer: this.lastPrinter,
      queue: this.queue.counts(),
      counters: this.counters(),
      activeSession: this.activeSession(),
    };
  }

  // ───────────────────────── sesi + kamera ─────────────────────────

  async startSession(sessionId: string, frameId: string | null): Promise<void> {
    if (!SESSION_ID_RE.test(sessionId)) throw new AgentError(400, "BAD_SESSION_ID");
    const cam = this.camera.status();
    if (!cam.connected) throw new AgentError(409, "CAMERA_OFFLINE", cam.lastError ?? undefined);

    // Kiosk memulai sesi lain: sesi aktif lama yang belum compose ditinggalkan.
    if (this.activeId && this.activeId !== sessionId) {
      const prev = this.row(this.activeId);
      if (prev && ["capturing", "reviewing"].includes(prev.phase)) this.finishLocal(prev.id, "abandoned");
    }
    if (frameId && !this.frames.has(frameId)) await this.frames.refresh().catch(() => false);

    const existing = this.row(sessionId);
    if (!existing) {
      await fsp.mkdir(this.dir(sessionId), { recursive: true });
      this.db
        .prepare("INSERT INTO sessions_local(id, frameId, phase, retakeUsed, shots, startedAt) VALUES (?, ?, 'capturing', ?, ?, ?)")
        .run(sessionId, frameId, JSON.stringify([false, false, false, false]), JSON.stringify([null, null, null, null]), Date.now());
    } else if (["finished", "abandoned", "orphaned"].includes(existing.phase)) {
      throw new AgentError(409, "SESSION_FINISHED");
    }
    // Sesi yang sama dimulai ulang (reload kiosk) = idempoten, progres dipertahankan.
    this.activeId = sessionId;
  }

  /** capture/retake: balas cepat `{accepted}`, hasil lewat event ws. */
  shoot(sessionId: string, slot: number, retake: boolean): void {
    const r = this.mustRow(sessionId);
    if (![1, 2, 3, 4].includes(slot)) throw new AgentError(400, "BAD_SLOT");
    if (!["capturing", "reviewing"].includes(r.phase)) throw new AgentError(409, "BAD_PHASE", r.phase);
    const shots = JSON.parse(r.shots) as Shots;
    const retakeUsed = JSON.parse(r.retakeUsed) as boolean[];
    if (retake) {
      if (retakeUsed[slot - 1]) throw new AgentError(409, "RETAKE_USED");
      if (shots[slot - 1] === null) throw new AgentError(409, "NO_PHOTO");
    }
    if (this.cameraBusy) throw new AgentError(409, "CAMERA_BUSY");
    this.cameraBusy = true;
    this.activeId = sessionId;
    this.setPhase(sessionId, "capturing");
    void this.runCapture(sessionId, slot as PhotoSlot, retake).finally(() => {
      this.cameraBusy = false;
      this.captureAbort = null;
    });
  }

  private async runCapture(sessionId: string, slot: PhotoSlot, retake: boolean): Promise<void> {
    const ctrl = new AbortController();
    this.captureAbort = ctrl;
    const timer = setTimeout(() => {
      ctrl.abort();
      this.camera.abort();
    }, CAPTURE_TIMEOUT_MS);
    const tmp = this.file(sessionId, `raw-${slot}.jpg.part`);
    let fired = false;
    try {
      await this.camera.capture(
        tmp,
        () => {
          fired = true;
          this.hub.emit({ type: "shutter_fired", sessionId, slot });
        },
        ctrl.signal,
      );
      if (!fired) this.hub.emit({ type: "shutter_fired", sessionId, slot });
      // Foto baru menggantikan lama hanya kalau jepret sukses (retake gagal = foto lama aman).
      await fsp.rename(tmp, this.file(sessionId, `raw-${slot}.jpg`));
      await makeThumb(this.file(sessionId, `raw-${slot}.jpg`), this.file(sessionId, `thumb-${slot}.jpg`));

      const r = this.mustRow(sessionId);
      const shots = JSON.parse(r.shots) as Shots;
      const retakeUsed = JSON.parse(r.retakeUsed) as boolean[];
      const version = (shots[slot - 1] ?? 0) + 1;
      shots[slot - 1] = version;
      if (retake) retakeUsed[slot - 1] = true;
      this.db
        .prepare("UPDATE sessions_local SET shots = ?, retakeUsed = ?, phase = 'reviewing' WHERE id = ?")
        .run(JSON.stringify(shots), JSON.stringify(retakeUsed), sessionId);
      this.hub.emit({
        type: "photo.ready",
        sessionId,
        slot,
        thumbUrl: this.thumbUrl(sessionId, slot, version),
        retakeUsed: retakeUsed[slot - 1]!,
      });
    } catch (err) {
      await fsp.rm(tmp, { force: true });
      const msg =
        ctrl.signal.aborted && !(err instanceof CameraError && err.code !== "ABORTED")
          ? `timeout ${CAPTURE_TIMEOUT_MS / 1000} detik`
          : err instanceof Error
            ? err.message
            : String(err);
      this.log.error("capture_failed", { sessionId, slot, retake, error: msg });
      const r = this.row(sessionId);
      if (r && r.phase === "capturing") {
        const shots = JSON.parse(r.shots) as Shots;
        if (shots.some((v) => v !== null)) this.setPhase(sessionId, "reviewing");
      }
      this.hub.emit({ type: "photo.failed", sessionId, slot, error: msg });
      if (err instanceof CameraError && err.code === "OFFLINE") this.hub.emit({ type: "camera.status", ...this.camera.status() });
    } finally {
      clearTimeout(timer);
    }
  }

  // ───────────────────────── compose + antrean ─────────────────────────

  async compose(sessionId: string): Promise<string> {
    const r = this.mustRow(sessionId);
    const url = this.compositeUrl(sessionId);
    // Idempoten: kiosk reload di PROCESSING memanggil compose lagi.
    if (r.phase === "finished" && fs.existsSync(this.file(sessionId, "composite.jpg"))) {
      this.hub.emit({ type: "compose.done", sessionId, compositeUrl: url });
      return url;
    }
    if (r.phase === "abandoned" || r.phase === "orphaned") throw new AgentError(409, "SESSION_FINISHED", r.phase);
    if (this.cameraBusy) throw new AgentError(409, "CAMERA_BUSY");
    const shots = JSON.parse(r.shots) as Shots;
    if (shots.some((v) => v === null)) throw new AgentError(409, "PHOTOS_INCOMPLETE");

    this.setPhase(sessionId, "composing");
    try {
      const frame = this.frames.get(r.frameId);
      await composeStrip({
        layout: frame.layout,
        photos: [1, 2, 3, 4].map((s) => this.file(sessionId, `raw-${s}.jpg`)),
        artworkPath: frame.artworkPath,
        outPath: this.file(sessionId, "composite.jpg"),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setPhase(sessionId, "reviewing");
      this.log.error("compose_failed", { sessionId, error: msg });
      this.hub.emit({ type: "compose.failed", sessionId, error: msg });
      throw new AgentError(500, "COMPOSE_FAILED", msg);
    }
    // Composite tersimpan + done diantrekan dalam satu transaksi: crash
    // setelah ini tetap berakhir di cloud.
    this.db.transaction(() => {
      this.finishLocal(sessionId, "finished");
      this.enqueueAfterCompose(sessionId);
    })();
    this.hub.emit({ type: "compose.done", sessionId, compositeUrl: url });
    return url;
  }

  private enqueueAfterCompose(sessionId: string): void {
    this.queue.enqueue(sessionId, "done");
    this.queue.enqueue(sessionId, "composite", { path: this.file(sessionId, "composite.jpg") });
    // Job foto diantrekan setelah filenya siap (hindari ENOENT saat antrean jalan duluan).
    this.track(this.prepareUploads(sessionId));
  }

  /** Versi upload foto mentah (≤ 3000 px, < 5 MB). Gagal = pakai raw apa adanya. */
  private async prepareUploads(sessionId: string): Promise<void> {
    for (let s = 1; s <= 4; s++) {
      if (this.stopping || this.row(sessionId)?.phase === "orphaned") return;
      const raw = this.file(sessionId, `raw-${s}.jpg`);
      const out = this.file(sessionId, `upload-${s}.jpg`);
      const queued = this.db
        .prepare("SELECT 1 FROM upload_queue WHERE sessionId = ? AND kind = 'photo' AND slot = ? LIMIT 1")
        .get(sessionId, s);
      if (queued) continue;
      if (fs.existsSync(out)) {
        this.queue.enqueue(sessionId, "photo", { slot: s, path: out });
        continue;
      }
      try {
        await sharp(raw)
          .rotate()
          .resize(UPLOAD_MAX_EDGE, UPLOAD_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toFile(`${out}.tmp`);
        await fsp.rename(`${out}.tmp`, out);
      } catch (err) {
        this.log.warn("upload_prepare_failed", { sessionId, slot: s, error: String(err) });
        await fsp.copyFile(raw, out).catch(() => undefined);
      }
      if (fs.existsSync(out)) this.queue.enqueue(sessionId, "photo", { slot: s, path: out });
    }
    this.queue.kick();
  }

  private onDoneOk(sessionId: string): void {
    this.cloudLog.push({ method: "BRIDGE", path: "done", status: 200, at: Date.now() });
    this.db.prepare("UPDATE sessions_local SET doneOk = 1 WHERE id = ?").run(sessionId);
    this.track(this.submitPrints(sessionId));
  }

  private onDoneRejected(sessionId: string, code: string): void {
    this.cloudLog.push({ method: "BRIDGE", path: "done", status: 409, at: Date.now() });
    // Voucher pengganti sudah dipakai (PRD bagian 10 #15): jangan cetak, jangan upload.
    this.log.warn("done_rejected_no_print", { sessionId, code });
    this.db.prepare("UPDATE sessions_local SET phase = 'orphaned' WHERE id = ?").run(sessionId);
    this.db
      .prepare("UPDATE upload_queue SET state = 'cancelled', lastError = ? WHERE sessionId = ? AND state IN ('pending','failed')")
      .run(`done ${code}`, sessionId);
  }

  // ───────────────────────── cetak ─────────────────────────

  private async submitPrints(sessionId: string, sheets: number[] = [1, 2], reprint = false): Promise<number[]> {
    const composite = this.file(sessionId, "composite.jpg");
    const ids: number[] = [];
    for (const sheet of sheets) {
      if (!reprint) {
        const exists = this.db.prepare("SELECT 1 FROM print_jobs WHERE sessionId = ? AND sheet = ? AND reprint = 0").get(sessionId, sheet);
        if (exists) continue;
      }
      const t = Date.now();
      // Baris dulu, baru lp: crash di tengah tidak mencetak dua kali.
      const row = this.db
        .prepare("INSERT INTO print_jobs(sessionId, sheet, state, reprint, createdAt, updatedAt) VALUES (?, ?, 'queued', ?, ?, ?)")
        .run(sessionId, sheet, reprint ? 1 : 0, t, t);
      const rowId = Number(row.lastInsertRowid);
      try {
        const jobId = await this.printer.submit(composite, `${sessionId}-${sheet}`);
        this.db.prepare("UPDATE print_jobs SET cupsJobId = ?, updatedAt = ? WHERE id = ?").run(jobId, Date.now(), rowId);
        ids.push(jobId);
        this.reportPrint(sessionId, sheet, "queued", jobId);
      } catch (err) {
        this.db.prepare("UPDATE print_jobs SET state = 'failed', updatedAt = ? WHERE id = ?").run(Date.now(), rowId);
        this.reportPrint(sessionId, sheet, "failed", null, String(err));
      }
    }
    return ids;
  }

  private reportPrint(sessionId: string, sheet: number, state: "queued" | "printing" | "done" | "failed", cupsJobId: number | null, error?: string): void {
    this.hub.emit({ type: "print.status", sessionId, sheet: sheet as 1 | 2, state, cupsJobId });
    this.queue.enqueue(sessionId, "print-status", { payload: { sheet, state, cupsJobId, ...(error ? { error: error.slice(0, 500) } : {}) } });
  }

  private polling = false;
  private async pollPrints(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const open = this.db
        .prepare("SELECT * FROM print_jobs WHERE state IN ('queued','printing') AND cupsJobId IS NOT NULL")
        .all() as PrintJobRow[];
      for (const j of open) {
        const st = await this.printer.jobState(j.cupsJobId!);
        if (st === j.state) continue;
        this.db.prepare("UPDATE print_jobs SET state = ?, updatedAt = ? WHERE id = ?").run(st, Date.now(), j.id);
        if (st === "done" && !j.counted) {
          this.db.transaction(() => {
            this.db.prepare("UPDATE print_jobs SET counted = 1 WHERE id = ?").run(j.id);
            this.db.prepare("UPDATE counters SET value = MAX(0, value - 1) WHERE name IN ('paper','ink')").run();
          })();
          this.hub.emit({ type: "counters.updated", ...this.counters() });
        }
        this.reportPrint(j.sessionId, j.sheet, st, j.cupsJobId);
      }
    } catch (err) {
      this.log.warn("print_poll_failed", { error: String(err) });
    } finally {
      this.polling = false;
    }
  }

  async reprint(sessionId: string, sheet: number): Promise<number> {
    this.mustRow(sessionId);
    if (sheet !== 1 && sheet !== 2) throw new AgentError(400, "BAD_SHEET");
    if (!fs.existsSync(this.file(sessionId, "composite.jpg"))) throw new AgentError(409, "NO_COMPOSITE");
    const [id] = await this.submitPrints(sessionId, [sheet], true);
    if (id === undefined) throw new AgentError(502, "PRINT_SUBMIT_FAILED");
    return id;
  }

  async printCopies(sessionId: string, copies: number): Promise<number[]> {
    this.mustRow(sessionId);
    if (!Number.isInteger(copies) || copies < 1 || copies > 4) throw new AgentError(400, "BAD_COPIES");
    if (!fs.existsSync(this.file(sessionId, "composite.jpg"))) throw new AgentError(409, "NO_COMPOSITE");
    return this.submitPrints(sessionId, Array.from({ length: copies }, (_, i) => (i % 2) + 1), true);
  }

  // ───────────────────────── staf ─────────────────────────

  static async hashPin(pin: string): Promise<string> {
    if (!/^\d{4}$/.test(pin)) throw new Error("PIN harus 4 digit angka");
    return argonHash(pin);
  }

  async staffLogin(pin: string): Promise<{ token: string; expiresAt: string }> {
    const now = Date.now();
    const lockedUntil = Number(kvGet(this.db, "pinLockedUntil") ?? 0);
    if (lockedUntil > now) throw new AgentError(423, "LOCKED", new Date(lockedUntil).toISOString());
    const hash = kvGet(this.db, "staffPinHash");
    if (!hash) throw new AgentError(503, "PIN_NOT_SET");

    const ok = /^\d{4}$/.test(pin) && (await argonVerify(hash, pin).catch(() => false));
    if (!ok) {
      const wrong = Number(kvGet(this.db, "pinWrong") ?? 0) + 1;
      if (wrong >= PIN_MAX_WRONG) {
        const level = Number(kvGet(this.db, "pinLockLevel") ?? 0);
        const until = now + PIN_LOCK_STEPS_MS[Math.min(level, PIN_LOCK_STEPS_MS.length - 1)]!;
        kvSet(this.db, "pinWrong", "0");
        kvSet(this.db, "pinLockLevel", String(level + 1));
        kvSet(this.db, "pinLockedUntil", String(until));
        this.log.warn("staff_pin_locked", { until: new Date(until).toISOString(), level: level + 1 });
        throw new AgentError(423, "LOCKED", new Date(until).toISOString());
      }
      kvSet(this.db, "pinWrong", String(wrong));
      throw new AgentError(401, "WRONG_PIN", String(PIN_MAX_WRONG - wrong));
    }
    kvSet(this.db, "pinWrong", "0");
    kvSet(this.db, "pinLockLevel", "0");
    const token = crypto.randomBytes(24).toString("base64url");
    const exp = now + STAFF_TOKEN_TTL_MS;
    this.staffTokens.set(token, exp);
    return { token, expiresAt: new Date(exp).toISOString() };
  }

  staffOk(token: unknown): boolean {
    if (typeof token !== "string") return false;
    const exp = this.staffTokens.get(token);
    if (!exp) return false;
    if (exp < Date.now()) {
      this.staffTokens.delete(token);
      return false;
    }
    return true;
  }

  async cameraReset(): Promise<CameraStatus> {
    if (this.cameraBusy) {
      this.captureAbort?.abort();
      this.camera.abort();
    }
    const st = await this.camera.reset();
    this.hub.emit({ type: "camera.status", ...st });
    return st;
  }

  async cancelVoucher(sessionId: string): Promise<{ code: string; voucherId: string }> {
    if (!SESSION_ID_RE.test(sessionId)) throw new AgentError(400, "BAD_SESSION_ID");
    const r = await this.cloud.cancelVoucher(sessionId, "staff-agent");
    this.cloudLog.push({ method: "BRIDGE", path: "cancel-voucher", status: r.status, at: Date.now() });
    if (r.status !== 200 || !r.body?.data) {
      throw new AgentError(r.status === 0 ? 502 : r.status, r.status === 0 ? "CLOUD_UNREACHABLE" : (r.body?.error ?? "CANCEL_FAILED"));
    }
    if (this.row(sessionId)) this.finishLocal(sessionId, "abandoned");
    if (this.activeId === sessionId) this.activeId = null;
    return { code: r.body.data.code, voucherId: r.body.data.voucherId };
  }

  setCounters(body: { paperAdd?: unknown; inkSet?: unknown }): AgentHealth["counters"] {
    const add = body.paperAdd === undefined ? 0 : Number(body.paperAdd);
    if (!Number.isInteger(add) || add < -1000 || add > 1000) throw new AgentError(400, "BAD_PAPER");
    if (add) this.db.prepare("UPDATE counters SET value = MAX(0, value + ?) WHERE name = 'paper'").run(add);
    if (body.inkSet !== undefined) {
      const ink = Number(body.inkSet);
      if (!Number.isInteger(ink) || ink < 0 || ink > 1000) throw new AgentError(400, "BAD_INK");
      this.db.prepare("UPDATE counters SET value = ? WHERE name = 'ink'").run(ink);
    }
    const c = this.counters();
    this.hub.emit({ type: "counters.updated", ...c });
    return c;
  }

  recentSessions(): StaffRecentSession[] {
    const rows = this.db
      .prepare("SELECT id, finishedAt FROM sessions_local WHERE phase = 'finished' ORDER BY finishedAt DESC LIMIT 20")
      .all() as { id: string; finishedAt: number }[];
    return rows
      .filter((r) => fs.existsSync(this.file(r.id, "composite.jpg")))
      .map((r) => ({ id: r.id, compositeUrl: this.compositeUrl(r.id), createdAt: new Date(r.finishedAt).toISOString() }));
  }

  // ───────────────────────── perawatan ─────────────────────────

  /** Hapus file sesi > 14 hari setelah selesai, hanya bila antreannya tuntas. */
  async cleanup(now = Date.now()): Promise<number> {
    const old = this.db
      .prepare("SELECT id FROM sessions_local WHERE finishedAt IS NOT NULL AND finishedAt < ?")
      .all(now - RETENTION_MS) as { id: string }[];
    let removed = 0;
    for (const { id } of old) {
      const busy = this.db
        .prepare("SELECT 1 FROM upload_queue WHERE sessionId = ? AND state IN ('pending','uploading','failed') LIMIT 1")
        .get(id);
      if (busy) continue;
      await fsp.rm(this.dir(id), { recursive: true, force: true });
      this.db.prepare("DELETE FROM sessions_local WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM upload_queue WHERE sessionId = ?").run(id);
      this.db.prepare("DELETE FROM print_jobs WHERE sessionId = ?").run(id);
      removed++;
    }
    return removed;
  }

  async heartbeat(): Promise<void> {
    const h = await this.health();
    const r = await this.cloud.heartbeat({
      version: this.cfg.version,
      camera: h.camera,
      printer: h.printer,
      counters: { paper: h.counters.paper, ink: h.counters.ink },
    });
    if (r.status !== 200) this.log.warn("heartbeat_failed", { status: r.status, error: r.error });
  }

  /** Kontrol uji: kembali ke keadaan bersih (rig e2e). */
  resetForTest(counters = 36): void {
    this.activeId = null;
    this.staffTokens.clear();
    this.cloudLog.length = 0;
    this.db.exec("DELETE FROM sessions_local; DELETE FROM upload_queue; DELETE FROM print_jobs;");
    this.db.prepare("UPDATE counters SET value = ?").run(counters);
    for (const k of ["pinWrong", "pinLockLevel", "pinLockedUntil"]) kvSet(this.db, k, null);
  }
}

function readBootId(): string | null {
  try {
    return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return null;
  }
}
