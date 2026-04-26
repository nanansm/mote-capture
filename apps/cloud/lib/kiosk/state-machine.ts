import type { Frame } from "@capture/shared";

export type KioskState =
  | "IDLE"
  | "PILIH_FRAME"
  | "KONFIRMASI"
  | "PAYMENT"
  | "PEMBAYARAN_OK"
  | "COUNTDOWN"
  | "PROCESSING"
  | "PREVIEW"
  | "INPUT_KONTAK"
  | "DONE";

export type KioskContext = {
  boothId: string;
  boothName: string;
  defaultPrice: number;
  sessionId?: string;
  selectedFrame?: Pick<Frame, "id" | "name" | "tier" | "price" | "previewUrl" | "backgroundUrl">;
  amount?: number;
  qrString?: string;
  paymentExpiresAt?: string;
  capturedPhotoUrls: string[];
  countdownStep: 1 | 2 | 3;
  countdownNumber: number;
  compositeUrl?: string;
  downloadToken?: string;
  customerPhone?: string;
  customerEmail?: string;
  errorMessage?: string;
  language: "id" | "en";
  mockMode: boolean;
  bridgeOnline: boolean;
};

export type KioskEvent =
  | { type: "TAP_START" }
  | { type: "FRAME_PICKED"; frame: KioskContext["selectedFrame"] }
  | { type: "CONFIRM_PAY" }
  | { type: "BACK" }
  | { type: "PAYMENT_QR"; sessionId: string; qrString: string; amount: number; expiresAt: string; mockMode: boolean }
  | { type: "PAYMENT_PAID"; sessionId: string }
  | { type: "PAYMENT_EXPIRED" }
  | { type: "TAP_MULAI_FOTO" }
  | { type: "ENTER_COUNTDOWN" }
  | { type: "COUNTDOWN_TICK"; value: number }
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
      countdownNumber: 5,
      language: opts.language,
      mockMode: opts.mockMode,
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
      if (event.type === "CONFIRM_PAY") {
        return { state: "PAYMENT", context };
      }
      if (event.type === "BACK") return { state: "PILIH_FRAME", context };
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
            mockMode: event.mockMode || context.mockMode,
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
          context: { ...context, countdownStep: 1, countdownNumber: 5 },
        };
      }
      break;
    case "COUNTDOWN":
      if (event.type === "COUNTDOWN_TICK") {
        return { state, context: { ...context, countdownNumber: event.value } };
      }
      if (event.type === "PHOTO_TAKEN") {
        const next = [...context.capturedPhotoUrls];
        next[event.index - 1] = event.url;
        if (event.index >= 3) {
          return {
            state: "PROCESSING",
            context: { ...context, capturedPhotoUrls: next, countdownNumber: 5 },
          };
        }
        const nextStep = ((event.index + 1) as 1 | 2 | 3);
        return {
          state,
          context: {
            ...context,
            capturedPhotoUrls: next,
            countdownStep: nextStep,
            countdownNumber: 5,
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
    countdownNumber: 5,
    language: context.language,
    mockMode: context.mockMode,
    bridgeOnline: context.bridgeOnline,
    errorMessage: undefined,
  };
}
