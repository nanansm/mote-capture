// Ported from apps/cloud/lib/wa/evolution.ts.
//
// Differences from the old module:
//  - No module-level `env` import from "@/lib/env" (apps/cloud read a
//    process.env-backed singleton). Every call takes `Env` (from
//    `getEnv(bindings)`) as an argument instead.
//  - `evolutionConfigured` was a module-level boolean computed once from
//    process.env in apps/cloud/lib/env.ts; here it's a small function
//    re-derived from the passed-in `Env` each call (cheap, and correct for
//    Workers where the same isolate can in theory see different bindings
//    across environments/deployments).
//  - `testConnection` (apps/cloud/lib/wa/evolution.ts:77-116) is not
//    ported — it isn't part of this task's scope (no connection-state route
//    here; src/routes/settings.ts already has its own WhatsApp ping).
import type { Env } from "@/lib/env";
import { logger } from "@/lib/logger";

export type SendTextResult = {
  ok: boolean;
  messageId?: string;
  mockMode: boolean;
  message?: string;
};

// Ported as-is from apps/cloud/lib/wa/evolution.ts.
export function formatPhoneNumber(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
}

// Credentials may come from the admin UI (D1, encrypted) or from Worker
// secrets. Callers resolve that ahead of time and pass the winner in; the env
// fields stay as the fallback for callers that have no DB handle.
export type EvolutionConfig = {
  apiUrl?: string;
  apiKey?: string;
  instanceName?: string;
};

function resolveEvolution(env: Env, override?: EvolutionConfig): Required<EvolutionConfig> | null {
  const apiUrl = override?.apiUrl ?? env.EVOLUTION_API_URL;
  const apiKey = override?.apiKey ?? env.EVOLUTION_API_KEY;
  const instanceName = override?.instanceName ?? env.EVOLUTION_INSTANCE_NAME;
  if (!apiUrl || !apiKey || !instanceName) return null;
  return { apiUrl, apiKey, instanceName };
}

export async function sendText(
  env: Env,
  params: { to: string; message: string },
  credentials?: EvolutionConfig,
): Promise<SendTextResult> {
  const number = formatPhoneNumber(params.to);
  if (!number) {
    return { ok: false, mockMode: false, message: "Nomor tidak valid" };
  }

  const evolution = resolveEvolution(env, credentials);
  if (!evolution) {
    logger.warn("wa_mock_send", { number, length: params.message.length });
    return { ok: true, mockMode: true, message: "Mock: WhatsApp tidak ter-konfigurasi" };
  }

  const url = `${evolution.apiUrl.replace(/\/$/, "")}/message/sendText/${evolution.instanceName}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: evolution.apiKey,
      },
      body: JSON.stringify({ number, text: params.message }),
    });
    const text = await res.text();
    if (!res.ok) {
      logger.error("wa_send_failed", { status: res.status, body: text.slice(0, 300) });
      return { ok: false, mockMode: false, message: `Evolution responded ${res.status}` };
    }
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // ignore
    }
    const messageId =
      typeof json.key === "object" && json.key && "id" in (json.key as Record<string, unknown>)
        ? String((json.key as Record<string, unknown>).id)
        : undefined;
    return { ok: true, messageId, mockMode: false };
  } catch (err) {
    logger.error("wa_send_error", { err: err instanceof Error ? err.message : String(err) });
    return {
      ok: false,
      mockMode: false,
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}
