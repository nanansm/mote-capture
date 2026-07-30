import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/use-translation";
import { initialMachine, reducer } from "@/lib/kiosk/state-machine";
import {
  createWsClient,
  KIOSK_TIMING,
  SocketEvents,
  type CompositeReadyPayload,
  type ErrorPayload,
  type KioskBootData,
  type KioskReadyPayload,
  type PaymentPaidPayload,
  type PhotoTakenPayload,
  type ResetPayload,
  type WsClient,
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

// ── WebSocket wiring ────────────────────────────────────────────────────
//
// apps/cloud drove this component over Socket.io (a server that ran
// alongside Next — see apps/cloud/lib/socket/server.ts). That server was
// replaced by a raw WebSocket at `/ws/kiosk/:boothId` on BoothDO (see
// apps/api/src/index.ts + apps/api/src/do/booth.ts), speaking the envelope
// protocol built in `@capture/shared` (`createWsClient` + `SocketEvents`).
//
// Requests that expect a reply go through `client.request(ev, data)`
// (replaces the old `emit(ev, payload, ackCallback)`); pushes from the
// server are dispatched into the state machine via `client.on(ev, handler)`.
// See the `useEffect` below that owns the client's lifecycle.
function buildKioskWsUrl(boothId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/kiosk/${encodeURIComponent(boothId)}`;
}

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
  // Which photo steps have already had their shutter requested. Per-step, not a
  // single boolean, because the kiosk now asks for every photo at its own
  // CHEESE — the latch only exists to survive re-renders of the same step.
  // Cleared on RESET via the IDLE effect below.
  const capturedStepsRef = useRef<Set<number>>(new Set());

  // WebSocket connection — one client per mounted boothId, torn down on
  // unmount. `wsConnected` mirrors the client's open/closed state so the UI
  // can show a "reconnecting" indicator; `createWsClient` handles the actual
  // reconnect-with-backoff internally, so this component never needs to
  // retry a connect itself.
  const wsClientRef = useRef<WsClient | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const wsRequest = useCallback(async <T = unknown,>(ev: string, data?: unknown): Promise<T> => {
    const client = wsClientRef.current;
    if (!client) throw new Error("WebSocket belum siap");
    return client.request(ev, data) as Promise<T>;
  }, []);

  useEffect(() => {
    const client = createWsClient({
      url: () => buildKioskWsUrl(props.boothId),
      onOpen: () => setWsConnected(true),
      onClose: () => setWsConnected(false),
    });
    wsClientRef.current = client;

    // Push handlers — server -> kiosk events, mapped onto the state machine's
    // reducer events. See kiosk-shell.tsx report notes for the events that
    // have no reducer equivalent (STATE_CHANGE, PRINT_DONE): those are
    // logged but intentionally not dispatched anywhere.
    const unsubs: Array<() => void> = [];
    const bind = <T,>(ev: string, handler: (data: T) => void) => {
      const wrapped = (data: unknown) => handler(data as T);
      client.on(ev, wrapped);
      unsubs.push(() => client.off(ev, wrapped));
    };

    bind<KioskReadyPayload>(SocketEvents.KIOSK_READY, (data) => {
      dispatch({ type: "SET_BRIDGE_STATUS", online: data.bridgeOnline, mockMode: data.useMockBridge });
    });
    // Not currently pushed by BoothDO (session:create's *reply* carries the
    // QR data instead — see requestSession below) — bound anyway so the
    // kiosk stays correct if the server starts pushing it independently
    // (e.g. a payment-provider webhook re-creating a QR mid-session).
    bind<{ sessionId: string; qrString: string; amount: number; expiresAt: string; mockMode: boolean }>(
      SocketEvents.PAYMENT_QR,
      (data) => dispatch({ type: "PAYMENT_QR", ...data }),
    );
    bind<PaymentPaidPayload>(SocketEvents.PAYMENT_PAID, (data) => {
      dispatch({ type: "PAYMENT_PAID", sessionId: data.sessionId });
    });
    bind<{ sessionId: string }>(SocketEvents.PAYMENT_EXPIRED, () => {
      dispatch({ type: "PAYMENT_EXPIRED" });
    });
    bind<PhotoTakenPayload>(SocketEvents.PHOTO_TAKEN, (data) => {
      dispatch({ type: "PHOTO_TAKEN", url: data.url, index: data.index });
    });
    bind<CompositeReadyPayload>(SocketEvents.COMPOSITE_READY, (data) => {
      dispatch({ type: "COMPOSITE_READY", url: data.url, downloadToken: data.downloadToken });
    });
    bind<ResetPayload>(SocketEvents.RESET, () => {
      dispatch({ type: "RESET" });
    });
    bind<ErrorPayload>(SocketEvents.ERROR, (data) => {
      dispatch({ type: "ERROR", message: data.message });
    });
    // No reducer equivalent — printing is fire-and-forget from the kiosk's
    // perspective (DONE is driven by CONTACT_SUBMITTED/timeout, not by the
    // physical printer finishing). Logged for observability only.
    bind<{ sessionId: string }>(SocketEvents.PRINT_DONE, (data) => {
      console.debug("[kiosk] print:done (no UI state change)", data);
    });
    bind<{ sessionId: string; state: string }>(SocketEvents.STATE_CHANGE, (data) => {
      console.debug("[kiosk] state:change push (no reducer mapping)", data);
    });

    return () => {
      for (const off of unsubs) off();
      client.close();
      wsClientRef.current = null;
    };
  }, [props.boothId]);

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

  // ── State-specific timers ──────────────────────────────────────────────

  // Reset the per-session shutter latches when we return to IDLE, so the next
  // session requests each photo again at its own CHEESE moment.
  useEffect(() => {
    if (state === "IDLE") capturedStepsRef.current.clear();
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

  // COUNTDOWN orchestration: GET_READY (photo 1 only) → 3 → 2 → 1 → CHEESE →
  // hold → shutter. The kiosk owns the shutter timing for EVERY photo, not
  // just the first: the guest is reading "CHEESE!", so that is the moment the
  // frame has to be grabbed. After the shutter we wait for the bridge's
  // PHOTO_TAKEN event, which advances the step and restarts the cadence.
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
        // Photos 2 and 3 open on "3" straight after the previous flash, so
        // hold that first digit a beat longer — otherwise the three shots read
        // as one continuous burst instead of three separate poses.
        const isFirstDigitOfLaterPhoto = context.countdownNumber === 3 && context.countdownStep > 1;
        const delay = isFirstDigitOfLaterPhoto
          ? KIOSK_TIMING.COUNTDOWN_TICK_MS + KIOSK_TIMING.POST_CAPTURE_HOLD_MS
          : KIOSK_TIMING.COUNTDOWN_TICK_MS;
        const id = window.setTimeout(() => {
          dispatch({ type: "COUNTDOWN_TICK", value: context.countdownNumber - 1 });
        }, delay);
        return () => window.clearTimeout(id);
      }
      // We just rendered "1" — after one tick, swap to CHEESE.
      const id = window.setTimeout(() => {
        dispatch({ type: "COUNTDOWN_PHASE", phase: "CHEESE" });
      }, KIOSK_TIMING.COUNTDOWN_TICK_MS);
      return () => window.clearTimeout(id);
    }

    // CHEESE: let the word sit on screen for CHEESE_HOLD_MS, then flash and ask
    // the cloud to fire the shutter for THIS step. The per-step latch keeps a
    // re-render from double-firing; the cloud also treats a repeat ask for an
    // already-captured index as a no-op, so a stray retry can't skip a photo.
    const step = context.countdownStep;
    if (phase === "CHEESE" && context.sessionId && !capturedStepsRef.current.has(step)) {
      capturedStepsRef.current.add(step);
      const sessionId = context.sessionId;
      let flashOffId = 0;
      const shutterId = window.setTimeout(() => {
        // The white flash was dead code until now — setFlashing was never
        // called anywhere, so the shutter had no visual feedback at all.
        setFlashing(true);
        flashOffId = window.setTimeout(() => setFlashing(false), KIOSK_TIMING.COUNTDOWN_FLASH_MS);
        void wsRequest(SocketEvents.START_CAPTURE, { sessionId, photoIndex: step }).catch((err) => {
          toast.error(err instanceof Error ? err.message : "Gagal memulai foto");
          capturedStepsRef.current.delete(step);
          dispatch({ type: "RESET" });
        });
      }, KIOSK_TIMING.CHEESE_HOLD_MS);
      return () => {
        window.clearTimeout(shutterId);
        if (flashOffId) window.clearTimeout(flashOffId);
        setFlashing(false);
      };
    }
  }, [state, context.countdownPhase, context.countdownNumber, context.countdownStep, context.sessionId, wsRequest]);

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
  const requestSession = useCallback(
    async (method: "qris" | "voucher") => {
      if (context.sessionId) return true;
      if (sessionInFlightRef.current) return true;
      if (!context.selectedFrame) return false;
      sessionInFlightRef.current = true;
      setBusy(true);
      try {
        const data = await wsRequest<{
          sessionId: string;
          qrString: string | null;
          amount: number;
          expiresAt: string;
          mockMode: boolean;
          method: "qris" | "voucher";
        }>(SocketEvents.CONFIRM_AND_PAY, {
          boothId: props.boothId,
          frameId: context.selectedFrame!.id,
          method,
        });
        // BoothDO answers CONFIRM_AND_PAY's *reply* with the QR data directly
        // (it never pushes a separate PAYMENT_QR event for this path) — feed
        // it into the same reducer event the push handler would use.
        dispatch({
          type: "PAYMENT_QR",
          sessionId: data.sessionId,
          qrString: data.qrString ?? "",
          amount: data.amount,
          expiresAt: data.expiresAt,
          mockMode: data.mockMode,
        });
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal membuat sesi");
        dispatch({ type: "RESET" });
        return false;
      } finally {
        sessionInFlightRef.current = false;
        setBusy(false);
      }
    },
    [context.sessionId, context.selectedFrame, props.boothId, wsRequest],
  );

  // Dispatch the method-selection event FIRST, *then* fire the request — in
  // that order, not the reverse. The reducer's PAYMENT_QR case only exists
  // under the PAYMENT/VOUCHER_INPUT states (see state-machine.ts), so if the
  // CONFIRM_AND_PAY reply's PAYMENT_QR dispatch above landed while still in
  // KONFIRMASI, the reducer would silently no-op it — the sessionId/qrString
  // would never make it into context. Dispatching CHOOSE_CASHLESS/
  // CHOOSE_VOUCHER synchronously up front guarantees we're already in a
  // PAYMENT_QR-aware state by the time the (inherently async) reply comes
  // back. If the request fails, requestSession dispatches RESET internally
  // to bail out cleanly.
  const handleChooseCashless = useCallback(() => {
    dispatch({ type: "CHOOSE_CASHLESS" });
    void requestSession("qris");
  }, [requestSession]);

  const handleChooseVoucher = useCallback(() => {
    dispatch({ type: "CHOOSE_VOUCHER" });
    void requestSession("voucher");
  }, [requestSession]);

  const handleVoucherRedeemed = useCallback((sessionId: string) => {
    dispatch({ type: "VOUCHER_REDEEMED", sessionId });
  }, []);

  const handleCancelPayment = useCallback(() => {
    if (!confirm(t("kiosk.cancel.confirm"))) return;
    // Fire-and-forget, same as the old Socket.io emit here: we dispatch
    // CANCEL locally right away for a snappy UI, regardless of whether the
    // server round-trip succeeds (BoothDO also pushes RESET back on success,
    // which the RESET push handler above turns into a harmless no-op re-reset).
    void wsRequest(SocketEvents.CANCEL, { sessionId: context.sessionId }).catch(() => undefined);
    dispatch({ type: "CANCEL" });
  }, [context.sessionId, t, wsRequest]);

  const handleStartCapture = useCallback(() => {
    if (!context.sessionId) return;
    // Don't emit START_CAPTURE here — the bridge captures the moment cloud
    // forwards it, which would fire the shutter ~10s before the guest sees
    // "CHEESE!" because of the GET_READY pre-phase. Instead, the COUNTDOWN
    // orchestrator emits it at each photo's CHEESE hold.
    capturedStepsRef.current.clear();
    dispatch({ type: "ENTER_COUNTDOWN" });
  }, [context.sessionId]);

  const handleSubmitContact = useCallback(
    async ({ phone, email }: { phone: string; email?: string }) => {
      if (!context.sessionId) return;
      setBusy(true);
      try {
        await wsRequest(SocketEvents.SUBMIT_CONTACT, {
          sessionId: context.sessionId,
          phone,
          email: email ?? "",
        });
        dispatch({ type: "CONTACT_SUBMITTED", phone, email });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
      } finally {
        setBusy(false);
      }
    },
    [context.sessionId, wsRequest],
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
            paymentMock={context.paymentMock}
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
      {!wsConnected ? (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-50 flex justify-center">
          <div className="flex items-center gap-2 rounded-full bg-brand-green-dark px-4 py-2 text-xs font-semibold text-white shadow-lg">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-yellow" />
            {t("kiosk.connection.reconnecting")}
          </div>
        </div>
      ) : null}
    </>
  );
}
