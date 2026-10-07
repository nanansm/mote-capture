// Antrean ke cloud (PRD bagian 9): done, composite, photo, print-status.
// Persisten di SQLite; dibaca ulang saat start. 1 job sekaligus.
import type { Db, JobKind, JobRow } from "./db.js";
import type { Cloud, CloudResult } from "./cloud.js";
import type { Hub } from "./hub.js";
import type { Logger } from "./log.js";

/** Backoff 5 s → 30 s → 2 menit → 10 menit (lalu tetap 10 menit). */
export const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];
export const MAX_ATTEMPTS = 20;
/**
 * Job siap jalan. Upload/print-status sebuah sesi menunggu `done` sesi itu
 * tuntas: sesi yang ditolak cloud (voucher pengganti terpakai) tidak boleh
 * sempat mengunggah foto.
 */
const READY = `q.state = 'pending' AND (q.kind = 'done' OR NOT EXISTS (
  SELECT 1 FROM upload_queue d WHERE d.sessionId = q.sessionId AND d.kind = 'done'
    AND d.state <> 'done'))`;

export type JobOutcome = "ok" | "retry" | "terminal";

export type QueueHooks = {
  /** `done` diterima cloud (200). */
  onDoneOk(sessionId: string): void;
  /** `done` ditolak 409 (SESSION_STALE / INVALID_STATE): jangan cetak. */
  onDoneRejected(sessionId: string, code: string): void;
};

export class UploadQueue {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private wake: (() => void) | null = null;

  constructor(
    private db: Db,
    private cloud: Cloud,
    private hub: Hub,
    private log: Logger,
    private hooks: QueueHooks,
    private now: () => number = Date.now,
  ) {
    // Job yang terpotong crash/listrik padam dijalankan ulang.
    this.db.prepare("UPDATE upload_queue SET state = 'pending' WHERE state = 'uploading'").run();
  }

  enqueue(sessionId: string, kind: JobKind, opts: { slot?: number; path?: string; payload?: unknown } = {}): number {
    const t = this.now();
    // Sesi yang `done`-nya sudah ditolak cloud: job baru langsung batal, bukan menggantung.
    const rejected =
      kind !== "done" &&
      this.db.prepare("SELECT 1 FROM upload_queue WHERE sessionId = ? AND kind = 'done' AND state = 'cancelled' LIMIT 1").get(sessionId);
    const r = this.db
      .prepare(
        `INSERT INTO upload_queue(sessionId, kind, slot, path, payload, state, attempt, nextAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        sessionId,
        kind,
        opts.slot ?? null,
        opts.path ?? null,
        opts.payload === undefined ? null : JSON.stringify(opts.payload),
        rejected ? "cancelled" : "pending",
        t,
        t,
        t,
      );
    this.kick();
    return Number(r.lastInsertRowid);
  }

  counts(): { pending: number; failed: number } {
    const r = this.db
      .prepare(
        `SELECT SUM(CASE WHEN state IN ('pending','uploading') THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed FROM upload_queue`,
      )
      .get() as { pending: number | null; failed: number | null };
    return { pending: r.pending ?? 0, failed: r.failed ?? 0 };
  }

  list(states: string[] = ["pending", "uploading", "failed"]): JobRow[] {
    const q = `SELECT * FROM upload_queue WHERE state IN (${states.map(() => "?").join(",")}) ORDER BY id LIMIT 100`;
    return this.db.prepare(q).all(...states) as JobRow[];
  }

  /** Staf: job `failed` dicoba lagi dari awal. */
  retryFailed(): number {
    const r = this.db
      .prepare("UPDATE upload_queue SET state = 'pending', attempt = 0, nextAt = ?, updatedAt = ? WHERE state = 'failed'")
      .run(this.now(), this.now());
    this.kick();
    return r.changes;
  }

  hasPending(sessionId: string, kind: JobKind): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM upload_queue WHERE sessionId = ? AND kind = ? AND state IN ('pending','uploading') LIMIT 1")
      .get(sessionId, kind);
  }

  start(): void {
    this.stopped = false;
    void this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.wake?.();
    while (this.running) await new Promise((r) => setTimeout(r, 20));
  }

  kick(): void {
    this.wake?.();
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const job = this.db
        .prepare(`SELECT * FROM upload_queue q WHERE ${READY} AND q.nextAt <= ? ORDER BY q.id LIMIT 1`)
        .get(this.now()) as JobRow | undefined;
      if (!job) {
        const next = this.db.prepare(`SELECT MIN(q.nextAt) AS n FROM upload_queue q WHERE ${READY}`).get() as { n: number | null };
        const wait = next.n === null ? 60_000 : Math.max(50, Math.min(60_000, next.n - this.now()));
        await new Promise<void>((resolve) => {
          this.wake = resolve;
          this.timer = setTimeout(resolve, wait);
        });
        this.wake = null;
        continue;
      }
      this.running = true;
      try {
        await this.runJob(job);
      } finally {
        this.running = false;
      }
    }
  }

  private setState(id: number, fields: Partial<Pick<JobRow, "state" | "attempt" | "nextAt" | "lastError">>): void {
    const cur = this.db.prepare("SELECT * FROM upload_queue WHERE id = ?").get(id) as JobRow;
    const n = { ...cur, ...fields, updatedAt: this.now() };
    this.db
      .prepare("UPDATE upload_queue SET state = ?, attempt = ?, nextAt = ?, lastError = ?, updatedAt = ? WHERE id = ?")
      .run(n.state, n.attempt, n.nextAt, n.lastError, n.updatedAt, id);
  }

  private emitUpload(job: JobRow, state: "pending" | "uploading" | "done" | "failed", attempt: number): void {
    if (job.kind !== "photo" && job.kind !== "composite") return;
    this.hub.emit({ type: "upload.status", sessionId: job.sessionId, kind: job.kind, state, attempt });
  }

  private async runJob(job: JobRow): Promise<void> {
    const attempt = job.attempt + 1;
    this.setState(job.id, { state: "uploading", attempt });
    this.emitUpload(job, "uploading", attempt);

    let res: CloudResult;
    try {
      res = await this.call(job);
    } catch (err) {
      res = { status: 0, body: null, error: err instanceof Error ? err.message : String(err) };
    }
    const outcome = this.classify(job, res);

    if (outcome === "ok" || outcome === "terminal") {
      this.setState(job.id, { state: outcome === "ok" ? "done" : "cancelled", lastError: outcome === "ok" ? null : `HTTP ${res.status}` });
      this.emitUpload(job, "done", attempt);
      return;
    }
    const lastError = res.error ?? `HTTP ${res.status}`;
    if (attempt >= MAX_ATTEMPTS) {
      this.setState(job.id, { state: "failed", lastError });
      this.emitUpload(job, "failed", attempt);
      this.log.error("queue_job_failed", { id: job.id, kind: job.kind, sessionId: job.sessionId, lastError });
      return;
    }
    const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]!;
    this.setState(job.id, { state: "pending", nextAt: this.now() + delay, lastError });
    this.emitUpload(job, "pending", attempt);
    this.log.warn("queue_job_retry", { id: job.id, kind: job.kind, attempt, delay, lastError });
  }

  private call(job: JobRow): Promise<CloudResult> {
    switch (job.kind) {
      case "done":
        return this.cloud.done(job.sessionId);
      case "composite":
        return this.cloud.uploadComposite(job.sessionId, job.path!);
      case "photo":
        return this.cloud.uploadPhoto(job.sessionId, job.slot!, job.path!);
      case "print-status":
        return this.cloud.printStatus(job.sessionId, JSON.parse(job.payload!));
    }
  }

  private classify(job: JobRow, res: CloudResult): JobOutcome {
    if (res.status >= 200 && res.status < 300) {
      if (job.kind === "done") this.hooks.onDoneOk(job.sessionId);
      return "ok";
    }
    if (job.kind === "done" && res.status === 409) {
      const code = (res.body as { error?: string } | null)?.error ?? "CONFLICT";
      this.hooks.onDoneRejected(job.sessionId, code);
      return "terminal";
    }
    // 404 sesi = tidak akan pernah berhasil (sesi dihapus/beda booth).
    if (res.status === 404) return "terminal";
    return "retry";
  }
}
