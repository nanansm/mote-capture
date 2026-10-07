// SQLite lokal agent (PRD bagian 9): sessions_local, upload_queue, counters, kv.
// WAL + synchronous FULL: listrik padam tidak boleh menghilangkan antrean.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Db = Database.Database;

export type LocalPhase = "capturing" | "reviewing" | "composing" | "finished" | "abandoned" | "orphaned";

export type SessionLocalRow = {
  id: string;
  frameId: string | null;
  phase: LocalPhase;
  /** JSON boolean[4] */
  retakeUsed: string;
  /** JSON (number|null)[4]: versi foto per slot (null = belum ada). */
  shots: string;
  startedAt: number;
  finishedAt: number | null;
  /** 1 = done dikonfirmasi cloud (200), boleh cetak. */
  doneOk: number;
};

export type JobKind = "done" | "composite" | "photo" | "print-status";
export type JobState = "pending" | "uploading" | "done" | "failed" | "cancelled";

export type JobRow = {
  id: number;
  sessionId: string;
  kind: JobKind;
  slot: number | null;
  path: string | null;
  payload: string | null;
  state: JobState;
  attempt: number;
  nextAt: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions_local (
  id TEXT PRIMARY KEY,
  frameId TEXT,
  phase TEXT NOT NULL,
  retakeUsed TEXT NOT NULL,
  shots TEXT NOT NULL,
  startedAt INTEGER NOT NULL,
  finishedAt INTEGER,
  doneOk INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS upload_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT NOT NULL,
  kind TEXT NOT NULL,
  slot INTEGER,
  path TEXT,
  payload TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt INTEGER NOT NULL DEFAULT 0,
  nextAt INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS upload_queue_state ON upload_queue(state, nextAt);
CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT NOT NULL,
  sheet INTEGER NOT NULL,
  cupsJobId INTEGER,
  state TEXT NOT NULL,
  reprint INTEGER NOT NULL DEFAULT 0,
  counted INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO counters(name, value) VALUES ('paper', 0), ('ink', 0);
`;

export type PrintJobRow = {
  id: number;
  sessionId: string;
  sheet: number;
  cupsJobId: number | null;
  state: "queued" | "printing" | "done" | "failed";
  reprint: number;
  counted: number;
  createdAt: number;
  updatedAt: number;
};

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "agent.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

export function closeDb(db: Db): void {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

export function kvGet(db: Db, key: string): string | null {
  const r = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function kvSet(db: Db, key: string, value: string | null): void {
  if (value === null) db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  else db.prepare("INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
