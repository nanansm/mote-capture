// Ported from apps/cloud/lib/payment/{index,factory}.ts, collapsed into one
// file (types.ts + xendit.ts + this factory is the full surface for this
// task — no separate providers/ subdir needed for a single provider).
//
// Unlike the old factory, this does NOT read a module-level `env` import or
// cache a singleton instance: every function here takes its credentials as
// an argument (the `Bindings` object off `c.env`), never a global. Workers
// bindings are cheap to read per-request, so there's no need to replicate
// the old `xenditInstance ??= new XenditProvider()` cache.
import type { Bindings } from "@/lib/env";
import type { PaymentProvider, PaymentProviderName } from "./types";
import { XenditProvider } from "./xendit";

export * from "./types";
export { XenditProvider } from "./xendit";
export type { XenditCredentials } from "./xendit";

// `credentials` wins over the Bindings fallback so an admin-entered key takes
// effect on the next request without a deploy (lib/runtime-credentials.ts).
// Callers that have a DB handle should always pass it; the env-only path
// remains for contexts that genuinely have no database access.
export function getPaymentProvider(
  name: PaymentProviderName,
  env: Bindings,
  credentials?: { secretKey?: string; webhookToken?: string },
): PaymentProvider {
  switch (name) {
    case "xendit":
      return new XenditProvider({
        secretKey: credentials?.secretKey ?? env.XENDIT_SECRET_KEY,
        webhookToken: credentials?.webhookToken ?? env.XENDIT_WEBHOOK_TOKEN,
      });
    case "ipaymu":
      throw new Error("iPaymu provider belum diimplementasikan (Sprint 2 hanya Xendit).");
    default:
      throw new Error(`Payment provider tidak dikenal: ${name satisfies never}`);
  }
}
