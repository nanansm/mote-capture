"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { io as createSocket, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/use-translation";
import { initialMachine, reducer } from "@/lib/kiosk/state-machine";
import {
  KIOSK_TIMING,
  SocketEvents,
  type KioskBootData,
  type PaymentPaidPayload,
  type PaymentQrPayload,
  type CompositeReadyPayload,
  type PhotoTakenPayload,
  type ResetPayload,
} from "@capture/shared";
import { LanguageToggle } from "./language-toggle";
import { IdleState } from "./states/idle";
import { PilihFrameState } from "./states/pilih-frame";
import { KonfirmasiState } from "./states/konfirmasi";
import { PaymentState } from "./states/payment";
import { PembayaranOkState } from "./states/pembayaran-ok";
import { CountdownState } from "./states/countdown";
import { ProcessingState } from "./states/processing";
import { PreviewState } from "./states/preview";
import { InputKontakState } from "./states/input-kontak";
import { DoneState } from "./states/done";
import { VoucherInputState } from "./states/voucher-input";

type FrameOption = KioskBootData["frames"][number];

type Props = {
  boothId: string;
  boothName: string;
  defaultPrice: number;
  useMockBridge: boolean;
  isActive: boolean;
};

export function KioskShell(props: Props) {
  const { t, lang, setLang } = useTranslation();
  const [machine, dispatch] = useReducer(
    reducer,
    initialMachine({
      boothId: props.boothId,
      boothName: props.boothName,
      defaultPrice: props.defaultPrice,
      language: "id",
      mockMode: props.useMockBridge,
      bridgeOnline: !props.useMockBridge,
    }),
  );
  const { state, context } = machine;
  const [frames, setFrames] = useState<FrameOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [doneCountdown, setDoneCountdown] = useState(8);
  const [flashing, setFlashing] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  // Latch that prevents START_CAPTURE from being emitted twice in one session.
  // Cleared on RESET via the IDLE effect below.
  const captureStartedRef = useRef(false);

  // Sync language from translation hook into machine context
  useEffect(() => {
    dispatch({ type: "SET_LANGUAGE", language: lang });
  }, [lang]);

  // Boot data fetch
  useEffect(() => {
    let active = true;
    fetch(`/api/kiosk/boot?boothId=${encodeURIComponent(props.boothId)}`)
      .then((r) => r.json())
      .then((body) => {
        if (!active) return;
        if (body?.data?.frames) setFrames(body.data.frames as FrameOption[]);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [props.boothId]);

  // Socket connection
  useEffect(() => {
    const socket = createSocket({
      auth: { type: "kiosk", boothId: props.boothId },
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      // Connected
    });
    socket.on("connect_error", (err: Error) => {
      console.error("[kiosk] socket error", err.message);
    });
    socket.on(SocketEvents.KIOSK_READY, (payload: { useMockBridge: boolean; bridgeOnline: boolean }) => {
      dispatch({
        type: "SET_BRIDGE_STATUS",
        online: payload.bridgeOnline,
        mockMode: payload.useMockBridge,
      });
    });
    socket.on(SocketEvents.PAYMENT_QR, (payload: PaymentQrPayload) => {
      dispatch({
        type: "PAYMENT_QR",
        sessionId: payload.sessionId,
        qrString: payload.qrString,
        amount: payload.amount,
        expiresAt: payload.expiresAt,
        mockMode: payload.mockMode,
      });
    });
    socket.on(SocketEvents.PAYMENT_PAID, (payload: PaymentPaidPayload) => {
      dispatch({ type: "PAYMENT_PAID", sessionId: payload.sessionId });
    });
    socket.on(SocketEvents.PAYMENT_EXPIRED, () => {
      dispatch({ type: "PAYMENT_EXPIRED" });
      toast.error(t("kiosk.payment.expired"));
    });
    socket.on(SocketEvents.PHOTO_TAKEN, (payload: PhotoTakenPayload) => {
      dispatch({ type: "PHOTO_TAKEN", url: payload.url, index: payload.index });
      // flash for 300ms
      setFlashing(true);
      window.setTimeout(() => setFlashing(false), KIOSK_TIMING.COUNTDOWN_FLASH_MS);
    });
    socket.on(SocketEvents.COMPOSITE_READY, (payload: CompositeReadyPayload) => {
      dispatch({
        type: "COMPOSITE_READY",
        url: payload.url,
        downloadToken: payload.downloadToken,
      });
    });
    socket.on(SocketEvents.RESET, (_payload: ResetPayload) => {
      dispatch({ type: "RESET" });
    });
    socket.on(SocketEvents.ERROR, (payload: { message: string }) => {
      dispatch({ type: "ERROR", message: payload.message ?? t("kiosk.error.unknown") });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.boothId]);

  // ── State-specific timers ──────────────────────────────────────────────

  // Reset the per-session capture-started latch when we return to IDLE,
  // so the next session emits START_CAPTURE again at its own CHEESE moment.
  useEffect(() => {
    if (state === "IDLE") captureStartedRef.current = false;
  }, [state]);

  // PAYMENT timeout — auto cancel when QR expires
  useEffect(() => {
    if (state !== "PAYMENT" || !context.paymentExpiresAt) return;
    const ms = new Date(context.paymentExpiresAt).getTime() - Date.now();
    if (ms <= 0) {
      dispatch({ type: "PAYMENT_EXPIRED" });
      return;
    }
    const id = window.setTimeout(() => dispatch({ type: "PAYMENT_EXPIRED" }), ms);
    return () => window.clearTimeout(id);
  }, [state, context.paymentExpiresAt]);

  // COUNTDOWN orchestration: GET_READY (photo 1 only) → 3 → 2 → 1 → CHEESE.
  // After the CHEESE flash, we hold and wait for the bridge's PHOTO_TAKEN
  // socket event to advance the step (the actual shutter timing is owned by
  // the camera driver, not the UI).
  useEffect(() => {
    if (state !== "COUNTDOWN") return;
    const phase = context.countdownPhase;

    if (phase === "GET_READY") {
      const id = window.setTimeout(() => {
        dispatch({ type: "COUNTDOWN_PHASE", phase: "COUNTDOWN" });
        dispatch({ type: "COUNTDOWN_TICK", value: 3 });
      }, KIOSK_TIMING.GET_READY_MS);
      return () => window.clearTimeout(id);
    }

    if (phase === "COUNTDOWN") {
      if (context.countdownNumber > 1) {
        const id = window.setTimeout(() => {
          dispatch({ type: "COUNTDOWN_TICK", value: context.countdownNumber - 1 });
        }, KIOSK_TIMING.COUNTDOWN_TICK_MS);
        return () => window.clearTimeout(id);
      }
      // We just rendered "1" — after one tick, swap to CHEESE.
      const id = window.setTimeout(() => {
        dispatch({ type: "COUNTDOWN_PHASE", phase: "CHEESE" });
      }, KIOSK_TIMING.COUNTDOWN_TICK_MS);
      return () => window.clearTimeout(id);
    }

    // CHEESE: tell the cloud to fire the bridge shutter for photo 1 — gated
    // by captureStartedRef so we only emit once per session even if the
    // CHEESE phase re-renders. Photos 2 & 3 are auto-cascaded by the cloud
    // when each PHOTO_UPLOADED arrives, so no per-photo emit is needed here.
    if (
      phase === "CHEESE" &&
      context.countdownStep === 1 &&
      context.sessionId &&
      !captureStartedRef.current
    ) {
      captureStartedRef.current = true;
      socketRef.current?.emit(
        SocketEvents.START_CAPTURE,
        { sessionId: context.sessionId },
        (ack: { ok: boolean; error?: string }) => {
          if (!ack?.ok) {
            toast.error(ack?.error ?? "Gagal memulai foto");
            captureStartedRef.current = false;
            dispatch({ type: "RESET" });
          }
        },
      );
    }
  }, [state, context.countdownPhase, context.countdownNumber, context.countdownStep, context.sessionId]);

  // PROCESSING timeout fallback
  useEffect(() => {
    if (state !== "PROCESSING") return;
    const id = window.setTimeout(() => {
      // If composite never arrived, give up gracefully
      dispatch({ type: "ERROR", message: t("kiosk.error.unknown") });
    }, KIOSK_TIMING.PROCESSING_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [state, t]);

  // PREVIEW auto-advance
  useEffect(() => {
    if (state !== "PREVIEW") return;
    const id = window.setTimeout(
      () => dispatch({ type: "PREVIEW_DONE" }),
      KIOSK_TIMING.PREVIEW_AUTO_ADVANCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [state]);

  // INPUT_KONTAK timeout — auto-skip
  useEffect(() => {
    if (state !== "INPUT_KONTAK") return;
    const id = window.setTimeout(
      () => dispatch({ type: "PREVIEW_DONE" }),
      KIOSK_TIMING.CONTACT_TIMEOUT_MS,
    );
    return () => window.clearTimeout(id);
  }, [state]);

  // DONE auto-reset to IDLE
  useEffect(() => {
    if (state !== "DONE") return;
    setDoneCountdown(8);
    const id = window.setInterval(() => {
      setDoneCountdown((n) => {
        if (n <= 1) {
          window.clearInterval(id);
          dispatch({ type: "RESET" });
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  // ── Action handlers ────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    dispatch({ type: "TAP_START" });
  }, []);

  const handleFramePicked = useCallback((frame: FrameOption) => {
    dispatch({ type: "FRAME_PICKED", frame });
  }, []);

  // Both method buttons share the same session creation: the cloud creates
  // the session row + (mock or real) Xendit QR, and the only thing that
  // differs is which next state we transition to. The voucher path ignores
  // the QR string but still needs sessionId from the PAYMENT_QR socket event.
  //
  // Idempotent on two axes:
  //   - if context.sessionId is already set, we skip the emit entirely
  //     (e.g. user navigates Voucher → Back → Voucher quickly)
  //   - sessionInFlightRef guards against rapid double-clicks while the
  //     first emit is still awaiting its ack
  const sessionInFlightRef = useRef(false);
  const requestSession = useCallback(async () => {
    if (context.sessionId) return true;
    if (sessionInFlightRef.current) return true;
    if (!context.selectedFrame) return false;
    sessionInFlightRef.current = true;
    setBusy(true);
    try {
      const ok = await new Promise<boolean>((resolve) => {
        socketRef.current?.emit(
          SocketEvents.CONFIRM_AND_PAY,
          { boothId: props.boothId, frameId: context.selectedFrame!.id },
          (ack: { ok: boolean; error?: string }) => {
            if (!ack?.ok) {
              toast.error(ack?.error ?? "Gagal membuat sesi");
              dispatch({ type: "RESET" });
              resolve(false);
              return;
            }
            resolve(true);
          },
        );
      });
      return ok;
    } finally {
      sessionInFlightRef.current = false;
      setBusy(false);
    }
  }, [context.sessionId, context.selectedFrame, props.boothId]);

  const handleChooseCashless = useCallback(async () => {
    const ok = await requestSession();
    if (ok) dispatch({ type: "CHOOSE_CASHLESS" });
  }, [requestSession]);

  const handleChooseVoucher = useCallback(async () => {
    // Dispatch first so the user sees VOUCHER_INPUT immediately. The session
    // creation runs in background and the input page shows a "preparing"
    // loading state until sessionId arrives via PAYMENT_QR. If the request
    // fails, requestSession dispatches RESET internally to bail out cleanly.
    dispatch({ type: "CHOOSE_VOUCHER" });
    void requestSession();
  }, [requestSession]);

  const handleVoucherRedeemed = useCallback((sessionId: string) => {
    dispatch({ type: "VOUCHER_REDEEMED", sessionId });
  }, []);

  const handleCancelPayment = useCallback(() => {
    if (!confirm(t("kiosk.cancel.confirm"))) return;
    socketRef.current?.emit(SocketEvents.CANCEL, { sessionId: context.sessionId });
    dispatch({ type: "CANCEL" });
  }, [context.sessionId, t]);

  const handleStartCapture = useCallback(() => {
    if (!context.sessionId) return;
    // Don't emit START_CAPTURE here — the bridge captures the moment cloud
    // forwards it, which would fire the shutter ~10s before the guest sees
    // "CHEESE!" because of the GET_READY pre-phase. Instead, the COUNTDOWN
    // orchestrator emits it when the CHEESE phase of photo 1 begins.
    captureStartedRef.current = false;
    dispatch({ type: "ENTER_COUNTDOWN" });
  }, [context.sessionId]);

  const handleSubmitContact = useCallback(
    async ({ phone, email }: { phone: string; email?: string }) => {
      if (!context.sessionId) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/session/${context.sessionId}/contact`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone, email: email ?? "" }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(body.error ?? "Gagal menyimpan");
          return;
        }
        dispatch({ type: "CONTACT_SUBMITTED", phone, email });
      } finally {
        setBusy(false);
      }
    },
    [context.sessionId],
  );

  const handleSkipContact = useCallback(() => {
    dispatch({ type: "PREVIEW_DONE" });
  }, []);

  // Hide language toggle for immersive states
  const showLangToggle = !["COUNTDOWN", "PROCESSING", "VOUCHER_INPUT"].includes(state);

  const renderState = useMemo(() => {
    switch (state) {
      case "IDLE":
        return (
          <IdleState defaultPrice={props.defaultPrice} onStart={handleStart} t={t} />
        );
      case "PILIH_FRAME":
        return (
          <PilihFrameState
            frames={frames}
            onPick={handleFramePicked}
            onBack={() => dispatch({ type: "BACK" })}
            t={t}
          />
        );
      case "KONFIRMASI":
        return context.selectedFrame ? (
          <KonfirmasiState
            frame={context.selectedFrame as FrameOption}
            onBack={() => dispatch({ type: "BACK" })}
            onChooseCashless={handleChooseCashless}
            onChooseVoucher={handleChooseVoucher}
            busy={busy}
            t={t}
          />
        ) : null;
      case "VOUCHER_INPUT":
        return (
          <VoucherInputState
            sessionId={context.sessionId}
            boothId={props.boothId}
            onBack={() => dispatch({ type: "BACK" })}
            onRedeemed={handleVoucherRedeemed}
            t={t}
          />
        );
      case "PAYMENT":
        return (
          <PaymentState
            sessionId={context.sessionId}
            qrString={context.qrString}
            amount={context.amount}
            expiresAt={context.paymentExpiresAt}
            mockMode={context.mockMode}
            onCancel={handleCancelPayment}
            t={t}
          />
        );
      case "PEMBAYARAN_OK":
        return <PembayaranOkState onStart={handleStartCapture} t={t} />;
      case "COUNTDOWN":
        return (
          <CountdownState
            step={context.countdownStep}
            number={context.countdownNumber}
            phase={context.countdownPhase}
            flashing={flashing}
            t={t}
          />
        );
      case "PROCESSING":
        return <ProcessingState photos={context.capturedPhotoUrls} t={t} />;
      case "PREVIEW":
        return <PreviewState compositeUrl={context.compositeUrl} t={t} />;
      case "INPUT_KONTAK":
        return (
          <InputKontakState
            onSubmit={handleSubmitContact}
            onSkip={handleSkipContact}
            busy={busy}
            t={t}
          />
        );
      case "DONE":
        return <DoneState countdown={doneCountdown} t={t} />;
    }
  }, [state, context, frames, busy, flashing, doneCountdown, t, handleStart, handleFramePicked, handleChooseCashless, handleChooseVoucher, handleVoucherRedeemed, handleCancelPayment, handleStartCapture, handleSubmitContact, handleSkipContact, props.defaultPrice, props.boothId]);

  return (
    <>
      {showLangToggle ? <LanguageToggle lang={lang} setLang={setLang} /> : null}
      <AnimatePresence mode="wait">
        <motion.div
          key={state}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute inset-0"
        >
          {renderState}
        </motion.div>
      </AnimatePresence>
      {context.errorMessage && state === "IDLE" ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-destructive px-4 py-2 text-sm text-white shadow-lg">
          {context.errorMessage}
        </div>
      ) : null}
    </>
  );
}

