// Mesin state kiosk M2 (PRD bagian 5). Murni: tidak ada I/O, tidak ada timer.
// Semua efek (ws DO, HTTP agent, timer) hidup di kiosk-shell.tsx dan masuk ke
// sini sebagai event. Dengan begitu tiap transisi bisa diuji tanpa browser.
import { KIOSK_TIMING, type KioskBootData, type PhotoSlot } from "@capture/shared";

export type KioskState =
  | "IDLE"
  | "PILIH_FRAME"
  | "KONFIRMASI"
  | "PAYMENT"
  | "VOUCHER_INPUT"
  | "PEMBAYARAN_OK"
  | "COUNTDOWN"
  | "REVIEW_SHOT"
  | "PROCESSING"
  | "DONE"
  | "CALL_STAFF"
  | "BOOTH_BUSY";

export type PaymentMethod = "qris" | "voucher";

/** GET_READY hanya sebelum foto 1; HOLD = "TAHAN!" sampai `shutter_fired`. */
export type CountdownPhase = "GET_READY" | "COUNTDOWN" | "HOLD";

export type FrameOption = KioskBootData["frames"][number];

export type CallStaffReason =
  | "CAMERA_OFFLINE"
  | "CAPTURE_TIMEOUT"
  | "PHOTO_FAILED"
  | "COMPOSE_FAILED"
  | "COMPOSE_TIMEOUT"
  | "AGENT_OFFLINE"
  | "RECOVERY_FAILED"
  | "ERROR";

export type KioskContext = {
  selectedFrame: FrameOption | null;
  method: PaymentMethod | null;
  sessionId: string | null;
  downloadToken: string | null;
  qrString: string | null;
  // DOKU Checkout: halaman bayar (berisi QRIS) ditampilkan di kiosk.
  paymentUrl: string | null;
  amount: number | null;
  expiresAt: string | null;
  /** Slot yang sedang/akan difoto (1..4). */
  slot: PhotoSlot;
  countdownPhase: CountdownPhase;
  countdown: number;
  /** thumbUrl per slot, indeks 0..3. */
  thumbs: (string | null)[];
  retakeUsed: boolean[];
  /** true saat sedang mengulang slot (tanpa fase GET_READY). */
  retaking: boolean;
  compositeUrl: string | null;
  callStaffReason: CallStaffReason | null;
  errorMessage: string | null;
  busyReleasesAt: string | null;
  voucherWrong: number;
};

export type KioskEvent =
  | { type: "TAP_START" }
  | { type: "FRAME_PICKED"; frame: FrameOption }
  | { type: "CHOOSE_METHOD"; method: PaymentMethod }
  | { type: "SESSION_CREATED"; sessionId: string; qrString: string | null; paymentUrl?: string | null; amount: number; expiresAt: string }
  | { type: "BOOTH_BUSY"; releasesAt: string | null }
  | { type: "VOUCHER_WRONG" }
  | { type: "PAYMENT_PAID"; sessionId: string; downloadToken: string | null }
  | { type: "PAYMENT_EXPIRED"; sessionId?: string }
  | { type: "CAPTURE_STARTED" }
  | { type: "COUNTDOWN_PHASE"; phase: CountdownPhase; value: number }
  | { type: "SHUTTER_FIRED"; sessionId: string; slot: PhotoSlot }
  | { type: "PHOTO_READY"; sessionId: string; slot: PhotoSlot; thumbUrl: string; retakeUsed: boolean }
  | { type: "RETAKE" }
  | { type: "REVIEW_DONE" }
  | { type: "COMPOSE_DONE"; sessionId: string; compositeUrl: string }
  | { type: "CALL_STAFF"; reason: CallStaffReason; message?: string }
  | {
      type: "RESUME";
      to: "PEMBAYARAN_OK" | "COUNTDOWN" | "REVIEW_SHOT" | "PROCESSING" | "DONE" | "CALL_STAFF";
      reason?: CallStaffReason;
      sessionId: string;
      downloadToken: string | null;
      slot?: PhotoSlot;
      thumbs?: (string | null)[];
      retakeUsed?: boolean[];
    }
  | { type: "BACK" }
  | { type: "TIMEOUT"; from: KioskState }
  | { type: "RESET" };

export type KioskMachine = { state: KioskState; context: KioskContext };

const PHOTO_COUNT = KIOSK_TIMING.PHOTO_COUNT;

function emptyContext(): KioskContext {
  return {
    selectedFrame: null,
    method: null,
    sessionId: null,
    downloadToken: null,
    qrString: null,
    paymentUrl: null,
    amount: null,
    expiresAt: null,
    slot: 1,
    countdownPhase: "GET_READY",
    countdown: 0,
    thumbs: Array(PHOTO_COUNT).fill(null),
    retakeUsed: Array(PHOTO_COUNT).fill(false),
    retaking: false,
    compositeUrl: null,
    callStaffReason: null,
    errorMessage: null,
    busyReleasesAt: null,
    voucherWrong: 0,
  };
}

export function initialMachine(): KioskMachine {
  return { state: "IDLE", context: emptyContext() };
}

const idle = (): KioskMachine => initialMachine();

/** Event milik sesi lain (sisa sesi lama / tab lain) diabaikan. */
function foreign(ctx: KioskContext, sessionId: string | undefined): boolean {
  return !!sessionId && !!ctx.sessionId && sessionId !== ctx.sessionId;
}

export function reducer(m: KioskMachine, ev: KioskEvent): KioskMachine {
  const { state, context: ctx } = m;
  const go = (s: KioskState, patch: Partial<KioskContext> = {}): KioskMachine => ({
    state: s,
    context: { ...ctx, ...patch },
  });

  // Global.
  switch (ev.type) {
    case "RESET":
      return idle();
    case "CALL_STAFF":
      if (state === "IDLE" || state === "DONE") return m;
      return go("CALL_STAFF", { callStaffReason: ev.reason, errorMessage: ev.message ?? null });
    case "RESUME":
      return {
        state: ev.to,
        context: {
          ...emptyContext(),
          sessionId: ev.sessionId,
          downloadToken: ev.downloadToken,
          slot: ev.slot ?? 1,
          thumbs: ev.thumbs ?? Array(PHOTO_COUNT).fill(null),
          retakeUsed: ev.retakeUsed ?? Array(PHOTO_COUNT).fill(false),
          countdownPhase: "COUNTDOWN",
          countdown: Math.round(KIOSK_TIMING.COUNTDOWN_PER_PHOTO_MS / 1000),
          callStaffReason: ev.to === "CALL_STAFF" ? (ev.reason ?? "RECOVERY_FAILED") : null,
        },
      };
    case "TIMEOUT":
      // Timer yang terlambat dari state sebelumnya tidak boleh memindah state.
      if (ev.from !== state) return m;
      if (state === "PROCESSING") return go("CALL_STAFF", { callStaffReason: "COMPOSE_TIMEOUT" });
      if (state === "COUNTDOWN") return go("CALL_STAFF", { callStaffReason: "CAPTURE_TIMEOUT" });
      if (state === "REVIEW_SHOT") return reducer(m, { type: "REVIEW_DONE" });
      return idle();
    default:
      break;
  }

  switch (state) {
    case "IDLE":
      if (ev.type === "TAP_START") return go("PILIH_FRAME");
      return m;

    case "PILIH_FRAME":
      if (ev.type === "FRAME_PICKED") return go("KONFIRMASI", { selectedFrame: ev.frame });
      if (ev.type === "BACK") return idle();
      return m;

    case "KONFIRMASI":
      if (ev.type === "CHOOSE_METHOD") return go(ev.method === "qris" ? "PAYMENT" : "VOUCHER_INPUT", { method: ev.method, sessionId: null, qrString: null, paymentUrl: null });
      if (ev.type === "BACK") return go("PILIH_FRAME", { selectedFrame: null, voucherWrong: 0 });
      if (ev.type === "BOOTH_BUSY") return go("BOOTH_BUSY", { busyReleasesAt: ev.releasesAt });
      return m;

    case "PAYMENT":
    case "VOUCHER_INPUT":
      if (ev.type === "SESSION_CREATED") {
        return go(state, { sessionId: ev.sessionId, qrString: ev.qrString, paymentUrl: ev.paymentUrl ?? null, amount: ev.amount, expiresAt: ev.expiresAt });
      }
      if (ev.type === "BOOTH_BUSY") return go("BOOTH_BUSY", { busyReleasesAt: ev.releasesAt });
      if (ev.type === "PAYMENT_PAID") {
        if (foreign(ctx, ev.sessionId)) return m;
        return go("PEMBAYARAN_OK", { sessionId: ev.sessionId, downloadToken: ev.downloadToken });
      }
      if (ev.type === "PAYMENT_EXPIRED") {
        if (foreign(ctx, ev.sessionId)) return m;
        return idle();
      }
      if (ev.type === "VOUCHER_WRONG" && state === "VOUCHER_INPUT") {
        const n = ctx.voucherWrong + 1;
        if (n >= KIOSK_TIMING.VOUCHER_MAX_WRONG) {
          return go("KONFIRMASI", { voucherWrong: 0, sessionId: null, method: null });
        }
        return go(state, { voucherWrong: n });
      }
      if (ev.type === "BACK") return go("KONFIRMASI", { sessionId: null, qrString: null, paymentUrl: null, method: null });
      return m;

    case "PEMBAYARAN_OK":
      // Voucher: callback redeem bisa tiba sebelum push PAYMENT_PAID yang
      // membawa downloadToken. Push yang belakangan cukup melengkapi token.
      if (ev.type === "PAYMENT_PAID" && ev.sessionId === ctx.sessionId && ev.downloadToken) {
        return go("PEMBAYARAN_OK", { downloadToken: ev.downloadToken });
      }
      if (ev.type === "CAPTURE_STARTED") {
        return go("COUNTDOWN", {
          slot: 1,
          retaking: false,
          countdownPhase: "GET_READY",
          countdown: Math.round(KIOSK_TIMING.GET_READY_MS / 1000),
        });
      }
      return m;

    case "COUNTDOWN":
      if (ev.type === "COUNTDOWN_PHASE") return go("COUNTDOWN", { countdownPhase: ev.phase, countdown: ev.value });
      if (ev.type === "SHUTTER_FIRED") {
        if (foreign(ctx, ev.sessionId) || ev.slot !== ctx.slot) return m;
        return go("COUNTDOWN", { countdownPhase: "HOLD", countdown: 0 });
      }
      if (ev.type === "PHOTO_READY") {
        if (foreign(ctx, ev.sessionId) || ev.slot !== ctx.slot) return m;
        const thumbs = [...ctx.thumbs];
        thumbs[ev.slot - 1] = ev.thumbUrl;
        const retakeUsed = [...ctx.retakeUsed];
        retakeUsed[ev.slot - 1] = ev.retakeUsed || retakeUsed[ev.slot - 1]!;
        return go("REVIEW_SHOT", { thumbs, retakeUsed, retaking: false });
      }
      return m;

    case "REVIEW_SHOT":
      if (ev.type === "RETAKE") {
        if (ctx.retakeUsed[ctx.slot - 1]) return m; // 1× per slot
        const retakeUsed = [...ctx.retakeUsed];
        retakeUsed[ctx.slot - 1] = true;
        return go("COUNTDOWN", {
          retakeUsed,
          retaking: true,
          countdownPhase: "COUNTDOWN",
          countdown: Math.round(KIOSK_TIMING.COUNTDOWN_PER_PHOTO_MS / 1000),
        });
      }
      if (ev.type === "REVIEW_DONE") {
        if (ctx.slot >= PHOTO_COUNT) return go("PROCESSING", { retaking: false });
        return go("COUNTDOWN", {
          slot: (ctx.slot + 1) as PhotoSlot,
          retaking: false,
          countdownPhase: "COUNTDOWN",
          countdown: Math.round(KIOSK_TIMING.COUNTDOWN_PER_PHOTO_MS / 1000),
        });
      }
      return m;

    case "PROCESSING":
      if (ev.type === "COMPOSE_DONE") {
        if (foreign(ctx, ev.sessionId)) return m;
        return go("DONE", { compositeUrl: ev.compositeUrl });
      }
      return m;

    case "CALL_STAFF":
      // Setelah staf reset kamera, shell mengirim RESUME. Selain itu tetap.
      return m;

    case "BOOTH_BUSY":
    case "DONE":
      return m;
  }
}
