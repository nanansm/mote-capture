import { env } from "@/lib/env";
import type { PaymentProvider } from "./types";
import { XenditProvider } from "./providers/xendit";

let xenditInstance: XenditProvider | null = null;

export function getPaymentProvider(name?: string): PaymentProvider {
  const provider = name ?? env.PAYMENT_DEFAULT_PROVIDER;
  switch (provider) {
    case "xendit":
      xenditInstance ??= new XenditProvider();
      return xenditInstance;
    case "ipaymu":
      throw new Error("iPaymu provider belum diimplementasikan (Sprint 2 hanya Xendit).");
    default:
      throw new Error(`Payment provider tidak dikenal: ${provider}`);
  }
}
