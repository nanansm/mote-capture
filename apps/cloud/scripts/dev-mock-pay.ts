#!/usr/bin/env tsx
// DEV-ONLY: hits the local mock-pay endpoint without leaving the terminal.
//
// Usage:
//   pnpm dev:mock-pay <sessionId>
//   pnpm dev:mock-pay --booth <boothId>     # auto-resolve to latest session
//
// CLOUD_URL env overrides the target (default: http://localhost:5000).

const baseUrl = (process.env.CLOUD_URL ?? "http://localhost:5000").replace(/\/$/, "");

function usage(): never {
  console.error("Usage: pnpm dev:mock-pay <sessionId>");
  console.error("       pnpm dev:mock-pay --booth <boothId>");
  process.exit(1);
}

async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = text as unknown as T;
  }
  return { ok: res.ok, status: res.status, data };
}

async function resolveSessionIdFromBooth(boothId: string): Promise<string> {
  const { ok, status, data } = await fetchJson<{ id?: string; error?: string }>(
    `${baseUrl}/api/dev/latest-session/${encodeURIComponent(boothId)}`,
  );
  if (!ok || !data?.id) {
    console.error(`Could not resolve session for booth ${boothId} (HTTP ${status}):`, data);
    process.exit(2);
  }
  return data.id;
}

async function main() {
  const args = process.argv.slice(2);
  let sessionId: string | undefined;

  if (args[0] === "--booth") {
    const boothId = args[1];
    if (!boothId) usage();
    sessionId = await resolveSessionIdFromBooth(boothId);
    console.error(`[dev-mock-pay] resolved booth=${boothId} → session=${sessionId}`);
  } else {
    sessionId = args[0];
  }

  if (!sessionId) usage();

  const result = await fetchJson(
    `${baseUrl}/api/dev/mock-pay/${encodeURIComponent(sessionId)}`,
    { method: "POST" },
  );
  console.log(JSON.stringify(result.data, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[dev-mock-pay] fatal:", err);
  process.exit(1);
});
