import { env, evolutionConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";

export type SendTextResult = {
  ok: boolean;
  messageId?: string;
  mockMode: boolean;
  message?: string;
};

export type ConnectionState = {
  connected: boolean;
  status: string;
  message: string;
  mockMode: boolean;
};

export function formatPhoneNumber(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
}

export async function sendText(params: {
  to: string;
  message: string;
}): Promise<SendTextResult> {
  const number = formatPhoneNumber(params.to);
  if (!number) {
    return { ok: false, mockMode: false, message: "Nomor tidak valid" };
  }

  if (!evolutionConfigured) {
    logger.warn("wa_mock_send", { number, length: params.message.length });
    return { ok: true, mockMode: true, message: "Mock: WhatsApp tidak ter-konfigurasi" };
  }

  const url = `${env.EVOLUTION_API_URL!.replace(/\/$/, "")}/message/sendText/${env.EVOLUTION_INSTANCE_NAME}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.EVOLUTION_API_KEY!,
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

export async function testConnection(): Promise<ConnectionState> {
  if (!evolutionConfigured) {
    return {
      connected: false,
      status: "not_configured",
      message: "EVOLUTION_API_URL/API_KEY belum di-set",
      mockMode: true,
    };
  }
  const url = `${env.EVOLUTION_API_URL!.replace(/\/$/, "")}/instance/connectionState/${env.EVOLUTION_INSTANCE_NAME}`;
  try {
    const res = await fetch(url, {
      headers: { apikey: env.EVOLUTION_API_KEY! },
    });
    if (!res.ok) {
      return {
        connected: false,
        status: "error",
        message: `Evolution responded ${res.status}`,
        mockMode: false,
      };
    }
    const json = (await res.json()) as Record<string, unknown>;
    const stateRaw = (json.instance as Record<string, unknown> | undefined)?.state ?? json.state;
    const state = typeof stateRaw === "string" ? stateRaw : "unknown";
    return {
      connected: state === "open",
      status: state,
      message: state === "open" ? "Terhubung" : `Status: ${state}`,
      mockMode: false,
    };
  } catch (err) {
    return {
      connected: false,
      status: "error",
      message: err instanceof Error ? err.message : "Network error",
      mockMode: false,
    };
  }
}
