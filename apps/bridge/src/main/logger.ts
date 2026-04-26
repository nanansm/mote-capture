import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import winston from "winston";
import "winston-daily-rotate-file";
import type { LogEntry } from "../shared/types";

const LOG_DIR = (() => {
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Logs", "Mote Capture Bridge");
    case "win32":
      return path.join(process.env.APPDATA ?? os.homedir(), "Mote Capture Bridge", "logs");
    default:
      return path.join(
        process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
        "mote-capture-bridge",
        "logs",
      );
  }
})();

fs.mkdirSync(LOG_DIR, { recursive: true });

const recentBuffer: LogEntry[] = [];
const MAX_RECENT = 500;
const subscribers = new Set<(entry: LogEntry) => void>();

const memoryTransport = new winston.transports.Stream({
  stream: new (require("node:stream").Writable)({
    write(chunk: Buffer, _enc: string, cb: () => void) {
      try {
        const raw = JSON.parse(chunk.toString()) as Record<string, unknown>;
        const { level, message, timestamp, ...rest } = raw;
        const entry: LogEntry = {
          ts: typeof timestamp === "string" ? timestamp : new Date().toISOString(),
          level: (level as LogEntry["level"]) ?? "info",
          message: typeof message === "string" ? message : String(message ?? ""),
          meta: Object.keys(rest).length > 0 ? rest : undefined,
        };
        recentBuffer.push(entry);
        if (recentBuffer.length > MAX_RECENT) recentBuffer.shift();
        for (const sub of subscribers) {
          try {
            sub(entry);
          } catch {
            // ignore subscriber errors
          }
        }
      } catch {
        // ignore non-JSON lines
      }
      cb();
    },
  }),
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
});

export const logger = winston.createLogger({
  level: process.env.BRIDGE_LOG_LEVEL ?? "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf((info) => {
          const { level, message, timestamp, ...rest } = info as Record<string, unknown>;
          const meta = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
          return `${timestamp} ${level} ${String(message)}${meta}`;
        }),
      ),
    }),
    new (winston.transports as unknown as { DailyRotateFile: new (opts: unknown) => winston.transport }).DailyRotateFile({
      dirname: LOG_DIR,
      filename: "bridge-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxFiles: "7d",
      maxSize: "10m",
    }),
    memoryTransport,
  ],
});

export function getLogDir(): string {
  return LOG_DIR;
}

export function getRecentLogs(): LogEntry[] {
  return recentBuffer.slice();
}

export function clearRecentLogs(): void {
  recentBuffer.length = 0;
}

export function subscribeLogs(fn: (entry: LogEntry) => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
