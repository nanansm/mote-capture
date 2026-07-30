// Single place that answers "what credentials should this request use?".
//
// Precedence is DB-first, Worker-secret-second. That ordering is what lets the
// admin rotate a Xendit key from the UI and have the very next checkout use it,
// while a booth that has never opened the settings page keeps running on the
// secrets it was deployed with. Nothing here throws: a missing or undecryptable
// credential degrades to the env value, and if that is absent too the caller
// falls into its existing mock/not-configured branch.
import type { Database } from "@/db";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { decryptSecret } from "@/lib/secret-box";
import { logger } from "@/lib/logger";

export type XenditCredentialSet = {
  secretKey?: string;
  webhookToken?: string;
};

export type EvolutionCredentialSet = {
  apiUrl?: string;
  apiKey?: string;
  instanceName?: string;
};

export type ResolvedCredentials = {
  xendit: XenditCredentialSet;
  evolution: EvolutionCredentialSet;
  // True when at least one stored credential could not be opened — surfaced by
  // the settings UI so a wrong/rotated SETTINGS_ENC_KEY is visible instead of
  // silently looking like "nothing configured".
  hasUndecryptable: boolean;
};

async function open(
  envelope: string,
  passphrase: string | undefined,
  field: string,
  state: { failed: boolean },
): Promise<string | undefined> {
  if (!envelope) return undefined;
  if (!passphrase) {
    // Stored credentials exist but the wrapping key is gone. Treat as absent.
    state.failed = true;
    logger.warn("credentials_enc_key_missing", { field });
    return undefined;
  }
  const plain = await decryptSecret(envelope, passphrase);
  if (plain === null) {
    state.failed = true;
    logger.warn("credentials_decrypt_failed", { field });
    return undefined;
  }
  return plain || undefined;
}

export async function resolveCredentials(
  db: Database,
  bindings: Bindings,
): Promise<ResolvedCredentials> {
  const env = getEnv(bindings);
  const stored = await getSetting(db, "credentials");
  const passphrase = bindings.SETTINGS_ENC_KEY;
  const state = { failed: false };

  const [secretKey, webhookToken, apiUrl, apiKey, instanceName] = await Promise.all([
    open(stored.xendit_secret_key, passphrase, "xendit_secret_key", state),
    open(stored.xendit_webhook_token, passphrase, "xendit_webhook_token", state),
    open(stored.evolution_api_url, passphrase, "evolution_api_url", state),
    open(stored.evolution_api_key, passphrase, "evolution_api_key", state),
    open(stored.evolution_instance_name, passphrase, "evolution_instance_name", state),
  ]);

  return {
    xendit: {
      secretKey: secretKey ?? env.XENDIT_SECRET_KEY,
      webhookToken: webhookToken ?? env.XENDIT_WEBHOOK_TOKEN,
    },
    evolution: {
      apiUrl: apiUrl ?? env.EVOLUTION_API_URL,
      apiKey: apiKey ?? env.EVOLUTION_API_KEY,
      instanceName: instanceName ?? env.EVOLUTION_INSTANCE_NAME,
    },
    hasUndecryptable: state.failed,
  };
}

// Which source each field actually came from, for the settings UI. Kept
// separate from resolveCredentials so the hot path doesn't pay for it.
export type CredentialSource = "ui" | "server" | "none";

export function credentialSource(storedEnvelope: string, envValue?: string): CredentialSource {
  if (storedEnvelope) return "ui";
  if (envValue) return "server";
  return "none";
}
