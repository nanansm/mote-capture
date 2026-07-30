import type { Frame } from "@capture/shared";

export type KioskState =
  | "IDLE"
  | "PILIH_FRAME"
  | "KONFIRMASI"
  | "VOUCHER_INPUT"
  | "PAYMENT"
  | "PEMBAYARAN_OK"
  | "COUNTDOWN"
  | "PROCESSING"
  | "PREVIEW"
  | "INPUT_KONTAK"
  | "DONE";

export type PaymentMethod = "cashless" | "voucher";

export type CountdownPhase = "GET_READY" | "COUNTDOWN" | "CHEESE";

export type KioskContext = {
  boothId: string;
  boothName: string;
  defaultPrice: number;
  sessionId?: string;
  selectedFrame?: Pick<Frame, "id" | "name" | "tier" | "price" | "previewUrl" | "backgroundUrl">;
  amount?: number;
  qrString?: string;
  paymentExpiresAt?: string;
  paymentMethod?: PaymentMethod;
  capturedPhotoUrls: string[];
  countdownStep: 1 | 2 | 3;
  countdownNumber: number;
  countdownPhase: CountdownPhase;
  compositeUrl?: string;
  downloadToken?: string;
  customerPhone?: string;
  customerEmail?: string;
  errorMessage?: string;
  language: "id" | "en";
  mockMode: boolean;
  // Kept separate from `mockMode`: that flag reflects the physical bridge/camera
  // connection (per-booth, survives across sessions), while this one reflects
  // whether the server's Xendit QR is a real payment or a stub (per-session,
  // sourced only from PAYMENT_QR) — conflating them made a real QRIS payment
  // show the "mock payment" banner just because the booth ran bridgeless.
  paymentMock: boolean;
  bridgeOnline: boolean;
};

export type KioskEvent =
  | { type: "TAP_START" }
  | { type: "FRAME_PICKED"; frame: KioskContext["selectedFrame"] }
  | { type: "CONFIRM_PAY" }
  | { type: "CHOOSE_CASHLESS" }
  | { type: "CHOOSE_VOUCHER" }
  | { type: "VOUCHER_REDEEMED"; sessionId: string }
  | { type: "BACK" }
  | { type: "PAYMENT_QR"; sessionId: string; qrString: string; amount: number; expiresAt: string; mockMode: boolean }
  | { type: "PAYMENT_PAID"; sessionId: string }
  | { type: "PAYMENT_EXPIRED" }
  | { type: "TAP_MULAI_FOTO" }
  | { type: "ENTER_COUNTDOWN" }
  | { type: "COUNTDOWN_TICK"; value: number }
  | { type: "COUNTDOWN_PHASE"; phase: CountdownPhase }
  | { type: "PHOTO_TAKEN"; url: string; index: number }
  | { type: "ENTER_PROCESSING" }
  | { type: "COMPOSITE_READY"; url: string; downloadToken: string }
  | { type: "PREVIEW_DONE" }
  | { type: "CONTACT_SUBMITTED"; phone: string; email?: string }
  | { type: "TIMEOUT"; from: KioskState }
  | { type: "CANCEL" }
  | { type: "RESET" }
  | { type: "ERROR"; message: string }
  | { type: "SET_LANGUAGE"; language: "id" | "en" }
  | { type: "SET_BRIDGE_STATUS"; online: boolean; mockMode: boolean };

export type KioskMachine = {
  state: KioskState;
  context: KioskContext;
};

export function initialMachine(opts: {
  boothId: string;
  boothName: string;
  defaultPrice: number;
  language: "id" | "en";
  mockMode: boolean;
  bridgeOnline: boolean;
}): KioskMachine {
  return {
    state: "IDLE",
    context: {
      boothId: opts.boothId,
      boothName: opts.boothName,
      defaultPrice: opts.defaultPrice,
      capturedPhotoUrls: [],
      countdownStep: 1,
      countdownNumber: 3,
      countdownPhase: "GET_READY",
      language: opts.language,
      mockMode: opts.mockMode,
      paymentMock: false,
      bridgeOnline: opts.bridgeOnline,
    },
  };
}

export function reducer(machine: KioskMachine, event: KioskEvent): KioskMachine {
  const { state, context } = machine;

  switch (event.type) {
    case "SET_LANGUAGE":
      return { state, context: { ...context, language: event.language } };
    case "SET_BRIDGE_STATUS":
      return {
        state,
        context: { ...context, bridgeOnline: event.online, mockMode: event.mockMode },
      };
    case "ERROR":
      return { state: "IDLE", context: { ...resetContext(context), errorMessage: event.message } };
    case "RESET":
    case "CANCEL":
    case "PAYMENT_EXPIRED":
    case "TIMEOUT":
      return { state: "IDLE", context: resetContext(context) };
  }

  switch (state) {
    case "IDLE":
      if (event.type === "TAP_START") {
        return { state: "PILIH_FRAME", context: { ...resetContext(context), errorMessage: undefined } };
      }
      break;
    case "PILIH_FRAME":
      if (event.type === "FRAME_PICKED") {
        return {
          state: "KONFIRMASI",
          context: {
            ...context,
            selectedFrame: event.frame,
            amount: event.frame?.price ?? context.defaultPrice,
          },
        };
      }
      if (event.type === "BACK") return { state: "IDLE", context: resetContext(context) };
      break;
    case "KONFIRMASI":
      if (event.type === "CHOOSE_CASHLESS" || event.type === "CONFIRM_PAY") {
        return { state: "PAYMENT", context: { ...context, paymentMethod: "cashless" } };
      }
      if (event.type === "CHOOSE_VOUCHER") {
        return { state: "VOUCHER_INPUT", context: { ...context, paymentMethod: "voucher" } };
      }
      if (event.type === "BACK") return { state: "PILIH_FRAME", context };
      break;
    case "VOUCHER_INPUT":
      if (event.type === "VOUCHER_REDEEMED" || event.type === "PAYMENT_PAID") {
        return {
          state: "PEMBAYARAN_OK",
          context: { ...context, sessionId: event.sessionId },
        };
      }
      // Same QR-arrival side-effect as PAYMENT — keeps sessionId/amount fresh
      // even though the voucher path ignores qrString.
      if (event.type === "PAYMENT_QR") {
        return {
          state,
          context: {
            ...context,
            sessionId: event.sessionId,
            qrString: event.qrString,
            amount: event.amount,
            paymentExpiresAt: event.expiresAt,
            paymentMock: event.mockMode,
          },
        };
      }
      if (event.type === "BACK") return { state: "KONFIRMASI", context };
      break;
    case "PAYMENT":
      if (event.type === "PAYMENT_QR") {
        return {
          state,
          context: {
            ...context,
            sessionId: event.sessionId,
            qrString: event.qrString,
            amount: event.amount,
            paymentExpiresAt: event.expiresAt,
            paymentMock: event.mockMode,
          },
        };
      }
      if (event.type === "PAYMENT_PAID") {
        return {
          state: "PEMBAYARAN_OK",
          context: { ...context, sessionId: event.sessionId },
        };
      }
      break;
    case "PEMBAYARAN_OK":
      if (event.type === "TAP_MULAI_FOTO" || event.type === "ENTER_COUNTDOWN") {
        return {
          state: "COUNTDOWN",
          context: {
            ...context,
            countdownStep: 1,
            countdownNumber: 3,
            countdownPhase: "GET_READY",
          },
        };
      }
      break;
    case "COUNTDOWN":
      if (event.type === "COUNTDOWN_TICK") {
        return { state, context: { ...context, countdownNumber: event.value } };
      }
      if (event.type === "COUNTDOWN_PHASE") {
        return { state, context: { ...context, countdownPhase: event.phase } };
      }
      if (event.type === "PHOTO_TAKEN") {
        const next = [...context.capturedPhotoUrls];
        next[event.index - 1] = event.url;
        if (event.index >= 3) {
          return {
            state: "PROCESSING",
            context: { ...context, capturedPhotoUrls: next, countdownNumber: 3 },
          };
        }
        const nextStep = ((event.index + 1) as 1 | 2 | 3);
        return {
          state,
          context: {
            ...context,
            capturedPhotoUrls: next,
            countdownStep: nextStep,
            countdownNumber: 3,
            // Photos 2 & 3 skip GET_READY — straight into the 3-2-1 cadence.
            countdownPhase: "COUNTDOWN",
          },
        };
      }
      if (event.type === "ENTER_PROCESSING") {
        return { state: "PROCESSING", context };
      }
      break;
    case "PROCESSING":
      if (event.type === "COMPOSITE_READY") {
        return {
          state: "PREVIEW",
          context: {
            ...context,
            compositeUrl: event.url,
            downloadToken: event.downloadToken,
          },
        };
      }
      break;
    case "PREVIEW":
      if (event.type === "PREVIEW_DONE") return { state: "INPUT_KONTAK", context };
      break;
    case "INPUT_KONTAK":
      if (event.type === "CONTACT_SUBMITTED") {
        return {
          state: "DONE",
          context: { ...context, customerPhone: event.phone, customerEmail: event.email },
        };
      }
      if (event.type === "PREVIEW_DONE") {
        return { state: "DONE", context };
      }
      break;
    case "DONE":
      // any reset event handled above
      break;
  }
  return machine;
}

function resetContext(context: KioskContext): KioskContext {
  return {
    boothId: context.boothId,
    boothName: context.boothName,
    defaultPrice: context.defaultPrice,
    capturedPhotoUrls: [],
    countdownStep: 1,
    countdownNumber: 3,
    countdownPhase: "GET_READY",
    language: context.language,
    mockMode: context.mockMode,
    // Per-session flag: a finished session must not leak its "was this a mock
    // payment" flag into the next customer's session.
    paymentMock: false,
    bridgeOnline: context.bridgeOnline,
    errorMessage: undefined,
  };
}
