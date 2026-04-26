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

  // COUNTDOWN: tick from 5 → 0, then wait for PHOTO_TAKEN socket event
  useEffect(() => {
    if (state !== "COUNTDOWN") return;
    if (context.countdownNumber <= 0) return;
    const id = window.setTimeout(() => {
      dispatch({ type: "COUNTDOWN_TICK", value: context.countdownNumber - 1 });
    }, KIOSK_TIMING.COUNTDOWN_TICK_MS);
    return () => window.clearTimeout(id);
  }, [state, context.countdownNumber]);

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

  const handleConfirmPay = useCallback(async () => {
    if (!context.selectedFrame) return;
    setBusy(true);
    try {
      socketRef.current?.emit(
        SocketEvents.CONFIRM_AND_PAY,
        { boothId: props.boothId, frameId: context.selectedFrame.id },
        (ack: { ok: boolean; error?: string }) => {
          if (!ack?.ok) {
            toast.error(ack?.error ?? "Gagal membuat sesi");
            dispatch({ type: "RESET" });
          }
        },
      );
      dispatch({ type: "CONFIRM_PAY" });
    } finally {
      setBusy(false);
    }
  }, [context.selectedFrame, props.boothId]);

  const handleCancelPayment = useCallback(() => {
    if (!confirm(t("kiosk.cancel.confirm"))) return;
    socketRef.current?.emit(SocketEvents.CANCEL, { sessionId: context.sessionId });
    dispatch({ type: "CANCEL" });
  }, [context.sessionId, t]);

  const handleStartCapture = useCallback(() => {
    if (!context.sessionId) return;
    socketRef.current?.emit(
      SocketEvents.START_CAPTURE,
      { sessionId: context.sessionId },
      (ack: { ok: boolean; error?: string }) => {
        if (!ack?.ok) toast.error(ack?.error ?? "Gagal memulai foto");
      },
    );
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
  const showLangToggle = !["COUNTDOWN", "PROCESSING"].includes(state);

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
            onConfirm={handleConfirmPay}
            busy={busy}
            t={t}
          />
        ) : null;
      case "PAYMENT":
        return (
          <PaymentState
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
  }, [state, context, frames, busy, flashing, doneCountdown, t, handleStart, handleFramePicked, handleConfirmPay, handleCancelPayment, handleStartCapture, handleSubmitContact, handleSkipContact, props.defaultPrice]);

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

