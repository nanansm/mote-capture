/** @type {import('next').NextConfig} */
const path = require("path");
const fs = require("fs");

// Load env from repo root so .env.local in monorepo root is honoured
// during both `next dev` and `next build`. Variables already set in the
// shell take precedence (process.env wins).
function loadRootEnv() {
  const root = path.join(__dirname, "../..");
  for (const file of [".env", ".env.local"]) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
loadRootEnv();

const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  reactStrictMode: true,
  images: {
    remotePatterns: [],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

module.exports = nextConfig;
