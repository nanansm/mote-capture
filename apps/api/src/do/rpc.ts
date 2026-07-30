// Typed seam between the HTTP layer and the Durable Objects.
//
// Routes never touch `sessions` / `photos` in D1 directly: BoothDO is the sole
// writer for those tables, so a single booth's state transitions are
// serialised by the DO's own single-threaded execution and cannot race.
// Everything else (booths, frames, vouchers, settings) is written by the
// Worker, and `payment_logs` is append-only so either side may write it.
//
// T3.2: implementations now call through to the real BoothDO (src/do/booth.ts)
// via its typed stub. Signatures are unchanged from the T1.1 stub so every
// existing caller (src/routes/*) keeps working untouched.
//
// T3.3: `adminBroadcast` now forwards to the AdminDO singleton
// (src/do/admin.ts). `env.ADMIN_DO` is typed as a plain (unparameterized)
// `DurableObjectNamespace` on `Bindings` (src/lib/env.ts is out of scope for
// this task), so the stub is cast to the real class's RPC surface here,
// locally, instead of widening that shared type.
import type { AdminDO } from "@/do/admin";
import type { Bindings } from "@/lib/env";
import { logger } from "@/lib/logger";

const ADMIN_DO_NAME = "overview";

function adminStub(env: Bindings) {
  const ns = env.ADMIN_DO as unknown as DurableObjectNamespace<AdminDO>;
  return ns.get(ns.idFromName(ADMIN_DO_NAME));
}

export type PhotoUploaded = {
  sessionId: string;
  index: number;
  r2Key: string;
};

export type CompositeUploaded = {
  sessionId: string;
  r2Key: string;
};

export type ContactInput = {
  sessionId: string;
  phone: string;
  email?: string;
};

function boothStub(env: Bindings, boothId: string) {
  return env.BOOTH_DO.get(env.BOOTH_DO.idFromName(boothId));
}

export async function markPaid(
  env: Bindings,
  boothId: string,
  sessionId: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await boothStub(env, boothId).markPaid(boothId, sessionId, meta);
}

export async function markExpired(
  env: Bindings,
  boothId: string,
  sessionId: string,
): Promise<void> {
  await boothStub(env, boothId).markExpired(boothId, sessionId);
}

// T2.10: admin "force reset" action (src/routes/session-admin.ts). Ported
// from apps/cloud/app/api/session/[id]/reset/route.ts, which wrote
// `sessions.status='failed'` and called `emitToBooth(...RESET...)` directly.
// BoothDO is the sole writer of `sessions` here, so the route only reads the
// session (to resolve boothId) and this RPC forwards the actual status
// change + kiosk broadcast to BoothDO.forceReset (src/do/booth.ts).
export async function forceReset(
  env: Bindings,
  boothId: string,
  sessionId: string,
  byEmail: string,
): Promise<void> {
  await boothStub(env, boothId).forceReset(boothId, sessionId, byEmail);
}

export type RefundInput = {
  reason: string;
  byEmail: string;
};

// T2.10: admin manual-refund action (src/routes/session-admin.ts). Ported
// from apps/cloud/app/api/session/[id]/refund/route.ts, which wrote
// `sessions.status='failed'` + a refund-metadata blob directly. Forwards to
// BoothDO.refundSession (src/do/booth.ts); `payment_logs` stays a direct
// Worker write since it's append-only.
export async function refundSession(
  env: Bindings,
  boothId: string,
  sessionId: string,
  input: RefundInput,
): Promise<void> {
  await boothStub(env, boothId).refundSession(boothId, sessionId, input);
}

export async function onPhotoUploaded(
  env: Bindings,
  boothId: string,
  input: PhotoUploaded,
): Promise<void> {
  await boothStub(env, boothId).onPhotoUploaded(boothId, input);
}

export async function onCompositeUploaded(
  env: Bindings,
  boothId: string,
  input: CompositeUploaded,
): Promise<void> {
  await boothStub(env, boothId).onCompositeUploaded(boothId, input);
}

export async function setContact(
  env: Bindings,
  boothId: string,
  input: ContactInput,
): Promise<void> {
  await boothStub(env, boothId).setContact(boothId, input);
}

// Fire-and-forget from BoothDO's perspective: a broadcast failure (AdminDO
// evicted, transient RPC error, whatever) must never fail the booth/session
// flow that triggered it, so every error is caught and logged here rather
// than propagated to the caller.
export async function adminBroadcast(
  env: Bindings,
  event: string,
  payload: unknown,
): Promise<void> {
  try {
    await adminStub(env).broadcast(event, payload);
  } catch (err) {
    logger.warn("admin_broadcast_failed", {
      event,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
