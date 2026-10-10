// Kiosk M2 (PRD bagian 5): satu komponen yang merangkai tiga sumber event ke
// mesin state murni (`@/lib/kiosk/state-machine`):
//   1. ws DO `/ws/kiosk/:boothId`  -> sesi & pembayaran (cloud)
//   2. ws agent `/agent/ws`        -> shutter, foto, compose (mini PC)
//   3. timer lokal                 -> countdown, review, idle reset
// Semua efek samping hidup di sini; reducer tidak pernah memanggil I/O.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { toast } from "sonner";
import {
  createWsClient,
  KIOSK_TIMING,
  SocketEvents,
  WsRequestError,
  type AgentEvent,
  type AgentHealth,
  type ErrorPayload,
  type KioskBootData,
  type KioskReadyPayload,
  type PaymentPaidPayload,
  type PhotoSlot,
  type ResetPayload,
  type WsClient,
} from "@capture/shared";
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  initialMachine,
  reducer,
  type CallStaffReason,
  type KioskEvent,
  type KioskMachine,
  type PaymentMethod,
} from "@/lib/kiosk/state-machine";
import { agent, agentAsset, connectAgentWs } from "@/lib/kiosk/agent";
import { LanguageToggle } from "./language-toggle";
import { StaffPanel } from "./staff-panel";
import { IdleState } from "./states/idle";
import { PilihFrameState } from "./states/pilih-frame";
import { KonfirmasiState } from "./states/konfirmasi";
import { PaymentState } from "./states/payment";
import { VoucherInputState } from "./states/voucher-input";
import { PembayaranOkState } from "./states/pembayaran-ok";
import { CountdownState } from "./states/countdown";
import { ReviewShotState } from "./states/review-shot";
import { ProcessingState } from "./states/processing";
import { DoneState } from "./states/done";
import { BoothBusyState, CallStaffState } from "./states/busy-call-staff";

type FrameOption = KioskBootData["frames"][number];

type Props = {
  boothId: string;
  boothName: string;
  defaultPrice: number;
  isActive: boolean;
  frames: FrameOption[];
};

function buildKioskWsUrl(boothId: string): string {
  // Rig uji / agent yang tidak mem-proxy `/ws` boleh menunjuk cloud langsung.
  const cloud = (import.meta.env.VITE_CLOUD_WS_URL as string | undefined)?.replace(/\/$/, "");
  if (cloud) return `${cloud}/ws/kiosk/${encodeURIComponent(boothId)}`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/kiosk/${encodeURIComponent(boothId)}`;
}

const sec = (ms: number) => Math.round(ms / 1000);
const IDLE_RESET_STATES = new Set(["PILIH_FRAME", "KONFIRMASI", "VOUCHER_INPUT", "BOOTH_BUSY"]);
const AGENT_CRITICAL_STATES = new Set(["COUNTDOWN", "REVIEW_SHOT", "PROCESSING"]);
const LANG_TOGGLE_STATES = new Set(["IDLE", "PILIH_FRAME", "KONFIRMASI", "DONE"]);

export function KioskShell(props: Props) {
  const { t, lang, setLang } = useTranslation();
  const [machine, dispatchRaw] = useReducer(reducer, undefined, initialMachine);
  const { state, context } = machine;

  // Ref ke mesin terkini untuk handler ws (closure-nya dibuat sekali).
  const machineRef = useRef<KioskMachine>(machine);
  machineRef.current = machine;
  const dispatch = useCallback((ev: KioskEvent) => dispatchRaw(ev), []);

  const [busy, setBusy] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [agentConnected, setAgentConnected] = useState(false);
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);
  const [reviewLeft, setReviewLeft] = useState(sec(KIOSK_TIMING.REVIEW_SHOT_MS));
  const [doneLeft, setDoneLeft] = useState(sec(KIOSK_TIMING.DONE_AUTO_RESET_MS));

  const wsRef = useRef<WsClient | null>(null);
  const sessionInFlight = useRef(false);
  const firedKey = useRef<string | null>(null);
  const composeKey = useRef<string | null>(null);
  const staffTaps = useRef<number[]>([]);

  const wsRequest = useCallback(async <T,>(ev: string, data?: unknown): Promise<T> => {
    const client = wsRef.current;
    if (!client) throw new Error("WebSocket belum siap");
    return (await client.request(ev, data)) as T;
  }, []);

  const callStaff = useCallback(
    (reason: CallStaffReason, message?: string) => dispatch({ type: "CALL_STAFF", reason, message }),
    [dispatch],
  );

  // ── Pemulihan setelah reload (PRD bagian 5) ────────────────────────────
  const recover = useCallback(
    async (snap: KioskReadyPayload["activeSession"]) => {
      if (!snap || machineRef.current.context.sessionId) return;
      // QR yang ditinggal tidak dipulihkan: DO memensiunkannya saat sesi baru.
      if (snap.status === "payment") return;
      const base = { sessionId: snap.id, downloadToken: snap.downloadToken };
      if (snap.status === "paid") {
        dispatch({ type: "RESUME", to: "PEMBAYARAN_OK", ...base });
        return;
      }
      let h: AgentHealth | null = null;
      try {
        h = await agent.health();
      } catch {
        h = null;
      }
      const a = h?.activeSession;
      if (!a || a.id !== snap.id) {
        dispatch({ type: "RESUME", to: "CALL_STAFF", reason: "RECOVERY_FAILED", ...base });
        return;
      }
      const thumbs = a.thumbs.map((u) => agentAsset(u));
      const common = { ...base, thumbs, retakeUsed: a.retakeUsed };
      if (a.phase === "capturing") dispatch({ type: "RESUME", to: "COUNTDOWN", slot: a.nextSlot, ...common });
      else if (a.phase === "reviewing") {
        const slot = Math.max(1, Math.min(KIOSK_TIMING.PHOTO_COUNT, a.nextSlot - 1)) as PhotoSlot;
        dispatch({ type: "RESUME", to: "REVIEW_SHOT", slot, ...common });
      } else if (a.phase === "composing") dispatch({ type: "RESUME", to: "PROCESSING", slot: 4, ...common });
      else dispatch({ type: "RESUME", to: "PROCESSING", slot: 4, ...common });
    },
    [dispatch],
  );

  // ── ws DO ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const client = createWsClient({
      url: () => buildKioskWsUrl(props.boothId),
      onOpen: () => setWsConnected(true),
      onClose: () => setWsConnected(false),
    });
    wsRef.current = client;
    const unsubs: Array<() => void> = [];
    const bind = <T,>(ev: string, fn: (data: T) => void) => {
      const wrapped = (d: unknown) => fn(d as T);
      client.on(ev, wrapped);
      unsubs.push(() => client.off(ev, wrapped));
    };
    bind<KioskReadyPayload>(SocketEvents.KIOSK_READY, (d) => void recover(d.activeSession));
    bind<PaymentPaidPayload>(SocketEvents.PAYMENT_PAID, (d) =>
      dispatch({ type: "PAYMENT_PAID", sessionId: d.sessionId, downloadToken: d.downloadToken ?? null }),
    );
    bind<{ sessionId?: string }>(SocketEvents.PAYMENT_EXPIRED, (d) =>
      dispatch({ type: "PAYMENT_EXPIRED", sessionId: d.sessionId }),
    );
    bind<ResetPayload>(SocketEvents.RESET, (d) => {
      const own = machineRef.current.context.sessionId;
      // RESET milik sesi lain (mis. checkout lama yang dipensiunkan) diabaikan.
      if (d.sessionId && own && d.sessionId !== own) return;
      if (!own && machineRef.current.state !== "IDLE" && d.sessionId) return;
      dispatch({ type: "RESET" });
    });
    bind<ErrorPayload>(SocketEvents.ERROR, (d) => toast.error(d.message));
    return () => {
      for (const off of unsubs) off();
      client.close();
      wsRef.current = null;
    };
  }, [props.boothId, dispatch, recover]);

  // ── ws agent + health ──────────────────────────────────────────────────
  useEffect(() => {
    const onEvent = (ev: AgentEvent) => {
      switch (ev.type) {
        case "camera.status":
          setHealth((h) => (h ? { ...h, camera: { connected: ev.connected, model: ev.model, lastError: ev.lastError } } : h));
          if (!ev.connected && AGENT_CRITICAL_STATES.has(machineRef.current.state)) callStaff("CAMERA_OFFLINE");
          return;
        case "shutter_fired":
          dispatch({ type: "SHUTTER_FIRED", sessionId: ev.sessionId, slot: ev.slot });
          setFlashing(true);
          window.setTimeout(() => setFlashing(false), KIOSK_TIMING.COUNTDOWN_FLASH_MS);
          return;
        case "photo.ready":
          dispatch({
            type: "PHOTO_READY",
            sessionId: ev.sessionId,
            slot: ev.slot,
            thumbUrl: agentAsset(ev.thumbUrl) ?? ev.thumbUrl,
            retakeUsed: ev.retakeUsed,
          });
          return;
        case "photo.failed":
          if (ev.sessionId === machineRef.current.context.sessionId) callStaff("PHOTO_FAILED", ev.error);
          return;
        case "compose.done":
          dispatch({ type: "COMPOSE_DONE", sessionId: ev.sessionId, compositeUrl: agentAsset(ev.compositeUrl) ?? ev.compositeUrl });
          return;
        case "compose.failed":
          if (ev.sessionId === machineRef.current.context.sessionId) callStaff("COMPOSE_FAILED", ev.error);
          return;
        case "counters.updated":
          setHealth((h) =>
            h ? { ...h, counters: { paper: ev.paper, ink: ev.ink, lowPaper: ev.lowPaper, lowInk: ev.lowInk } } : h,
          );
          return;
        default:
          return;
      }
    };
    const stop = connectAgentWs({
      onEvent,
      onOpen: () => setAgentConnected(true),
      onClose: () => setAgentConnected(false),
    });
    let alive = true;
    const poll = async () => {
      try {
        const h = await agent.health();
        if (alive) setHealth(h);
      } catch {
        if (alive) setHealth(null);
      }
    };
    void poll();
    const id = window.setInterval(poll, 10_000);
    return () => {
      alive = false;
      stop();
      window.clearInterval(id);
    };
  }, [dispatch, callStaff]);

  // Agent hilang lebih lama dari grace saat sesi berjalan: panggil staf.
  useEffect(() => {
    if (agentConnected || !AGENT_CRITICAL_STATES.has(state)) return;
    const id = window.setTimeout(() => callStaff("AGENT_OFFLINE"), KIOSK_TIMING.AGENT_WS_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [agentConnected, state, callStaff]);

  // ── Sesi & pembayaran ──────────────────────────────────────────────────
  const chooseMethod = useCallback(
    async (method: PaymentMethod) => {
      const frame = machineRef.current.context.selectedFrame;
      if (!frame || sessionInFlight.current) return;
      sessionInFlight.current = true;
      setBusy(true);
      dispatch({ type: "CHOOSE_METHOD", method });
      try {
        const data = await wsRequest<{ sessionId: string; qrString: string | null; paymentUrl?: string | null; amount: number; expiresAt: string }>(
          SocketEvents.CONFIRM_AND_PAY,
          { boothId: props.boothId, frameId: frame.id, method },
        );
        dispatch({ type: "SESSION_CREATED", ...data });
      } catch (err) {
        if (err instanceof WsRequestError && err.code === "BOOTH_BUSY") {
          const r = err.details?.releasesAt;
          dispatch({ type: "BOOTH_BUSY", releasesAt: typeof r === "string" ? r : null });
        } else {
          toast.error(err instanceof Error ? err.message : t("kiosk.error.session"));
          dispatch({ type: "RESET" });
        }
      } finally {
        sessionInFlight.current = false;
        setBusy(false);
      }
    },
    [dispatch, props.boothId, t, wsRequest],
  );

  const cancelSession = useCallback(
    (reason: string) => {
      const sessionId = machineRef.current.context.sessionId;
      if (sessionId) void wsRequest(SocketEvents.CANCEL, { sessionId, reason }).catch(() => undefined);
    },
    [wsRequest],
  );

  const backFromPayment = useCallback(() => {
    cancelSession("customer-back");
    dispatch({ type: "BACK" });
  }, [cancelSession, dispatch]);

  // QR kedaluwarsa lokal (cadangan kalau push PAYMENT_EXPIRED hilang).
  useEffect(() => {
    if (state !== "PAYMENT" || !context.expiresAt) return;
    const ms = new Date(context.expiresAt).getTime() - Date.now();
    const id = window.setTimeout(() => dispatch({ type: "PAYMENT_EXPIRED", sessionId: context.sessionId ?? undefined }), Math.max(0, ms));
    return () => window.clearTimeout(id);
  }, [state, context.expiresAt, context.sessionId, dispatch]);

  const startCapture = useCallback(async () => {
    const { sessionId, selectedFrame } = machineRef.current.context;
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      await wsRequest(SocketEvents.START_CAPTURE, { sessionId });
    } catch (err) {
      setBusy(false);
      toast.error(err instanceof Error ? err.message : t("kiosk.error.session"));
      return;
    }
    try {
      await agent.startSession(sessionId, selectedFrame?.id ?? null);
      dispatch({ type: "CAPTURE_STARTED" });
    } catch {
      callStaff("AGENT_OFFLINE");
    } finally {
      setBusy(false);
    }
  }, [busy, callStaff, dispatch, t, wsRequest]);

  // ── Countdown -> shutter ───────────────────────────────────────────────
  useEffect(() => {
    if (state !== "COUNTDOWN") {
      firedKey.current = null;
      return;
    }
    const { countdownPhase: phase, countdown, slot, retaking, sessionId } = context;
    if (phase === "GET_READY" || phase === "COUNTDOWN") {
      const id = window.setTimeout(() => {
        if (countdown > 1) dispatch({ type: "COUNTDOWN_PHASE", phase, value: countdown - 1 });
        else if (phase === "GET_READY")
          dispatch({ type: "COUNTDOWN_PHASE", phase: "COUNTDOWN", value: sec(KIOSK_TIMING.COUNTDOWN_PER_PHOTO_MS) });
        else dispatch({ type: "COUNTDOWN_PHASE", phase: "HOLD", value: 0 });
      }, KIOSK_TIMING.COUNTDOWN_TICK_MS);
      return () => window.clearTimeout(id);
    }
    // HOLD: picu shutter sekali per (sesi, slot, retake), tunggu photo.ready.
    const key = `${sessionId}:${slot}:${retaking ? "r" : "c"}`;
    if (sessionId && firedKey.current !== key) {
      firedKey.current = key;
      const req = retaking ? agent.retake(sessionId, slot) : agent.capture(sessionId, slot);
      req
        .then((r) => {
          if (!r.accepted) callStaff("PHOTO_FAILED", "capture ditolak agent");
        })
        .catch(() => callStaff("AGENT_OFFLINE"));
    }
    const id = window.setTimeout(() => dispatch({ type: "TIMEOUT", from: "COUNTDOWN" }), KIOSK_TIMING.CAPTURE_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [state, context, dispatch, callStaff]);

  // ── Review per foto ────────────────────────────────────────────────────
  useEffect(() => {
    if (state !== "REVIEW_SHOT") return;
    setReviewLeft(sec(KIOSK_TIMING.REVIEW_SHOT_MS));
    const started = Date.now();
    const tick = window.setInterval(() => {
      setReviewLeft(Math.max(0, sec(KIOSK_TIMING.REVIEW_SHOT_MS - (Date.now() - started))));
    }, 250);
    const id = window.setTimeout(() => dispatch({ type: "TIMEOUT", from: "REVIEW_SHOT" }), KIOSK_TIMING.REVIEW_SHOT_MS);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(id);
    };
  }, [state, context.slot, dispatch]);

  // ── Compose ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (state !== "PROCESSING") return;
    const sessionId = context.sessionId;
    if (sessionId && composeKey.current !== sessionId) {
      composeKey.current = sessionId;
      agent
        .compose(sessionId)
        .then((r) => {
          if (r?.compositePath) dispatch({ type: "COMPOSE_DONE", sessionId, compositeUrl: agentAsset(r.compositePath)! });
        })
        .catch(() => undefined); // compose.failed / timeout yang memanggil staf
    }
    const id = window.setTimeout(() => dispatch({ type: "TIMEOUT", from: "PROCESSING" }), KIOSK_TIMING.PROCESSING_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [state, context.sessionId, dispatch]);

  useEffect(() => {
    if (state === "IDLE") composeKey.current = null;
  }, [state]);

  // ── DONE auto reset ────────────────────────────────────────────────────
  useEffect(() => {
    if (state !== "DONE") return;
    const started = Date.now();
    setDoneLeft(sec(KIOSK_TIMING.DONE_AUTO_RESET_MS));
    const tick = window.setInterval(() => {
      setDoneLeft(Math.max(0, sec(KIOSK_TIMING.DONE_AUTO_RESET_MS - (Date.now() - started))));
    }, 500);
    const id = window.setTimeout(() => dispatch({ type: "TIMEOUT", from: "DONE" }), KIOSK_TIMING.DONE_AUTO_RESET_MS);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(id);
    };
  }, [state, dispatch]);

  // ── Idle reset tanpa sentuhan ──────────────────────────────────────────
  useEffect(() => {
    if (!IDLE_RESET_STATES.has(state) || staffOpen) return;
    let id = 0;
    const arm = () => {
      window.clearTimeout(id);
      id = window.setTimeout(() => {
        if (machineRef.current.state === "VOUCHER_INPUT") cancelSession("idle-timeout");
        dispatch({ type: "TIMEOUT", from: machineRef.current.state });
      }, KIOSK_TIMING.IDLE_RESET_MS);
    };
    arm();
    window.addEventListener("pointerdown", arm);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", arm);
    };
  }, [state, staffOpen, cancelSession, dispatch]);

  // ── Akses staf: 5 tap pojok kiri atas dalam 3 detik ────────────────────
  const onStaffCorner = useCallback(() => {
    const now = Date.now();
    staffTaps.current = [...staffTaps.current.filter((x) => now - x < KIOSK_TIMING.STAFF_TAP_WINDOW_MS), now];
    if (staffTaps.current.length >= KIOSK_TIMING.STAFF_TAP_COUNT) {
      staffTaps.current = [];
      setStaffOpen(true);
    }
  }, []);

  const onStaffResume = useCallback(() => {
    const m = machineRef.current;
    if (m.state !== "CALL_STAFF" || !m.context.sessionId) return;
    const compose = m.context.callStaffReason === "COMPOSE_FAILED" || m.context.callStaffReason === "COMPOSE_TIMEOUT";
    composeKey.current = null;
    dispatch({
      type: "RESUME",
      to: compose ? "PROCESSING" : "COUNTDOWN",
      sessionId: m.context.sessionId,
      downloadToken: m.context.downloadToken,
      slot: m.context.slot,
      thumbs: m.context.thumbs,
      retakeUsed: m.context.retakeUsed,
    });
    setStaffOpen(false);
  }, [dispatch]);

  // ── Render ─────────────────────────────────────────────────────────────
  const cameraDown = !health || !health.camera.connected;
  const blocked = !props.isActive || cameraDown;
  const lowSupply = !!health && (health.counters.lowPaper || health.counters.lowInk);

  let view: React.ReactNode = null;
  switch (state) {
    case "IDLE":
      view = (
        <IdleState defaultPrice={props.defaultPrice} onStart={() => dispatch({ type: "TAP_START" })} blocked={blocked} lowSupply={lowSupply} t={t} />
      );
      break;
    case "PILIH_FRAME":
      view = (
        <PilihFrameState
          frames={props.frames}
          onPick={(frame) => dispatch({ type: "FRAME_PICKED", frame })}
          onBack={() => dispatch({ type: "BACK" })}
          t={t}
        />
      );
      break;
    case "KONFIRMASI":
      view = context.selectedFrame ? (
        <KonfirmasiState
          frame={context.selectedFrame}
          onBack={() => dispatch({ type: "BACK" })}
          onChooseCashless={() => void chooseMethod("qris")}
          onChooseVoucher={() => void chooseMethod("voucher")}
          busy={busy}
          t={t}
        />
      ) : null;
      break;
    case "PAYMENT":
      view = (
        <PaymentState
          sessionId={context.sessionId ?? undefined}
          qrString={context.qrString ?? undefined}
          paymentUrl={context.paymentUrl ?? undefined}
          amount={context.amount ?? undefined}
          expiresAt={context.expiresAt ?? undefined}
          onCancel={backFromPayment}
          t={t}
        />
      );
      break;
    case "VOUCHER_INPUT":
      view = (
        <VoucherInputState
          sessionId={context.sessionId ?? undefined}
          boothId={props.boothId}
          onBack={backFromPayment}
          onRedeemed={(sessionId) => dispatch({ type: "PAYMENT_PAID", sessionId, downloadToken: null })}
          onWrong={() => dispatch({ type: "VOUCHER_WRONG" })}
          t={t}
        />
      );
      break;
    case "PEMBAYARAN_OK":
      view = <PembayaranOkState onStart={() => void startCapture()} busy={busy} t={t} />;
      break;
    case "COUNTDOWN":
      view = (
        <CountdownState
          step={context.slot}
          number={context.countdown}
          phase={context.countdownPhase}
          flashing={flashing}
          retaking={context.retaking}
          t={t}
        />
      );
      break;
    case "REVIEW_SHOT":
      view = (
        <ReviewShotState
          slot={context.slot}
          thumbUrl={context.thumbs[context.slot - 1] ?? null}
          canRetake={!context.retakeUsed[context.slot - 1]}
          secondsLeft={reviewLeft}
          busy={false}
          onRetake={() => dispatch({ type: "RETAKE" })}
          onNext={() => dispatch({ type: "REVIEW_DONE" })}
          t={t}
        />
      );
      break;
    case "PROCESSING":
      view = <ProcessingState photos={context.thumbs.filter((x): x is string => !!x)} t={t} />;
      break;
    case "DONE":
      view = (
        <DoneState
          compositeUrl={context.compositeUrl}
          downloadToken={context.downloadToken}
          countdown={doneLeft}
          onFinish={() => dispatch({ type: "RESET" })}
          t={t}
        />
      );
      break;
    case "BOOTH_BUSY":
      view = <BoothBusyState releasesAt={context.busyReleasesAt} onOk={() => dispatch({ type: "RESET" })} t={t} />;
      break;
    case "CALL_STAFF":
      view = <CallStaffState reason={context.callStaffReason} onStaff={() => setStaffOpen(true)} t={t} />;
      break;
  }

  // reducedMotion "user": animasi transform mati bila OS minta (aksesibilitas;
  // juga membuat e2e deterministik). Kiosk produksi tetap beranimasi.
  return (
    <MotionConfig reducedMotion="user">
    <div data-testid="kiosk" data-state={state} data-session-id={context.sessionId ?? ""} className="absolute inset-0">
      {LANG_TOGGLE_STATES.has(state) ? <LanguageToggle lang={lang} setLang={setLang} /> : null}
      <AnimatePresence mode="wait">
        <motion.div
          key={state}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0"
        >
          {view}
        </motion.div>
      </AnimatePresence>
      <button
        type="button"
        aria-label="staff"
        data-testid="staff-corner"
        onClick={onStaffCorner}
        className="absolute left-0 top-0 z-40 h-20 w-20 opacity-0"
      />
      {staffOpen ? (
        <StaffPanel
          sessionId={context.sessionId}
          onClose={() => setStaffOpen(false)}
          onResume={onStaffResume}
          // Panel tetap terbuka: staf perlu membaca kode voucher ke pelanggan.
          onSessionCancelled={() => dispatch({ type: "RESET" })}
          t={t}
        />
      ) : null}
      {!wsConnected ? (
        <div data-testid="ws-reconnecting" className="pointer-events-none absolute inset-x-0 top-4 z-50 flex justify-center">
          <div className="flex items-center gap-2 rounded-full bg-brand-green-dark px-4 py-2 text-xs font-semibold text-white shadow-lg">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-yellow" />
            {t("kiosk.connection.reconnecting")}
          </div>
        </div>
      ) : null}
    </div>
    </MotionConfig>
  );
}
