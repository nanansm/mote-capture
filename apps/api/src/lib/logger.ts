// Minimal structured logger, dependency-free.
//
// Signature intentionally mirrors the winston logger used in the old
// apps/cloud app (`logger.info("event_name", { a, b })`) so ported files
// can keep their existing import + call sites unchanged.

type Meta = Record<string, unknown>;

function write(level: string, msg: string, meta?: Meta): void {
  const line = JSON.stringify({ level, msg, ...meta });
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (msg: string, meta?: Meta) => write("info", msg, meta),
  warn: (msg: string, meta?: Meta) => write("warn", msg, meta),
  error: (msg: string, meta?: Meta) => write("error", msg, meta),
  debug: (msg: string, meta?: Meta) => write("debug", msg, meta),
};
