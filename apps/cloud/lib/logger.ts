import { createLogger, format, transports } from "winston";

const isProd = process.env.NODE_ENV === "production";

export const logger = createLogger({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  defaultMeta: { service: "capture-cloud" },
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    isProd ? format.json() : format.combine(format.colorize(), format.simple()),
  ),
  transports: [new transports.Console()],
});
