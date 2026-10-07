// Logger JSON satu baris (journald). Nol token di log.
export type Logger = {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
};

export function createLogger(silent = false): Logger {
  const out = (level: string, msg: string, meta?: Record<string, unknown>) => {
    if (silent) return;
    process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta }) + "\n");
  };
  return {
    info: (m, x) => out("info", m, x),
    warn: (m, x) => out("warn", m, x),
    error: (m, x) => out("error", m, x),
  };
}
