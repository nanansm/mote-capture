// Halaman staf ber-PIN (PRD bagian 6). Dibuka dari pojok kiri atas 5x dalam
// 3 detik atau tombol "Barista" di CALL_STAFF. Semua aksi lewat agent lokal;
// token staf hanya hidup di memori komponen ini (hilang saat panel ditutup).
import { useCallback, useEffect, useRef, useState } from "react";
import { Delete, Loader2, X } from "lucide-react";
import { KIOSK_TIMING, type AgentHealth, type StaffRecentSession } from "@capture/shared";
import { agent, AgentError } from "@/lib/kiosk/agent";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

export function StaffPanel({
  sessionId,
  onClose,
  onResume,
  onSessionCancelled,
  t,
}: {
  /** Sesi aktif (kalau ada) untuk aksi batal + voucher. */
  sessionId: string | null;
  onClose: () => void;
  /** Setelah reset kamera OK: kiosk lanjut dari slot yang gagal. */
  onResume: () => void;
  onSessionCancelled: () => void;
  t: T;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [sessions, setSessions] = useState<StaffRecentSession[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idleTimer = useRef<number | null>(null);

  // Keluar otomatis setelah 2 menit tanpa sentuhan.
  const bump = useCallback(() => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(onClose, KIOSK_TIMING.STAFF_IDLE_MS);
  }, [onClose]);
  useEffect(() => {
    bump();
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, [bump]);

  const submitPin = useCallback(
    async (value: string) => {
      setChecking(true);
      setPinMsg(null);
      try {
        const res = await agent.staffLogin(value);
        if ("token" in res) {
          setToken(res.token);
        } else if (res.error === "LOCKED") {
          setPinMsg(t("staff.pin.locked", { time: new Date(res.lockedUntil).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) }));
        } else {
          setPinMsg(t("staff.pin.wrong", { n: res.attemptsLeft }));
        }
      } catch {
        setPinMsg(t("staff.pin.error"));
      } finally {
        setPin("");
        setChecking(false);
      }
    },
    [t],
  );

  const press = (d: string) => {
    bump();
    if (checking) return;
    const next = (pin + d).slice(0, KIOSK_TIMING.STAFF_PIN_LENGTH);
    setPin(next);
    if (next.length === KIOSK_TIMING.STAFF_PIN_LENGTH) void submitPin(next);
  };

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setHealth(await agent.health());
      setSessions(await agent.recentSessions(token));
    } catch {
      setMsg(t("staff.pin.error"));
    }
  }, [token, t]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<string | void>) => {
    bump();
    setBusy(true);
    setMsg(null);
    try {
      const out = await fn();
      setMsg(out ?? t("staff.done"));
      await refresh();
    } catch (err) {
      if (err instanceof AgentError && err.status === 401) {
        setToken(null); // token kedaluwarsa: minta PIN lagi
        setMsg(null);
      } else {
        setMsg(err instanceof AgentError ? (err.code ?? err.message) : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="staff-panel" className="fixed inset-0 z-[100] flex flex-col bg-white text-brand-green-dark" onPointerDown={bump}>
      <div className="flex items-center justify-between border-b border-brand-green-dark/10 px-8 py-4">
        <h2 className="text-2xl font-extrabold">{token ? t("staff.title") : t("staff.pin.title")}</h2>
        <button type="button" data-testid="staff-exit" onClick={onClose} className="inline-flex items-center gap-2 rounded-full bg-brand-green-dark px-5 py-2 font-semibold text-white">
          <X className="h-4 w-4" />
          {t("staff.exit")}
        </button>
      </div>

      {!token ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <div data-testid="pin-dots" className="flex gap-4">
            {Array.from({ length: KIOSK_TIMING.STAFF_PIN_LENGTH }, (_, i) => (
              <span key={i} className={"h-5 w-5 rounded-full border-2 border-brand-green-dark " + (i < pin.length ? "bg-brand-green-dark" : "")} />
            ))}
          </div>
          <div className="min-h-[28px] text-lg font-semibold text-red-600" data-testid="pin-message">
            {checking ? <Loader2 className="h-6 w-6 animate-spin text-brand-green-dark" /> : pinMsg}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button key={d} type="button" data-testid={`pin-${d}`} onClick={() => press(d)} className="h-20 w-20 rounded-2xl bg-brand-green-dark/5 text-3xl font-bold">
                {d}
              </button>
            ))}
            <span />
            <button type="button" data-testid="pin-0" onClick={() => press("0")} className="h-20 w-20 rounded-2xl bg-brand-green-dark/5 text-3xl font-bold">
              0
            </button>
            <button type="button" aria-label="hapus" onClick={() => setPin(pin.slice(0, -1))} className="flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-green-dark/5">
              <Delete className="h-7 w-7" />
            </button>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 gap-6 overflow-y-auto px-8 py-6 lg:grid-cols-2">
          <section className="space-y-2 rounded-2xl border border-brand-green-dark/10 p-5">
            <h3 className="text-lg font-bold">{t("staff.status")}</h3>
            <p data-testid="staff-camera">
              {t("staff.camera")}: {health ? (health.camera.connected ? `OK (${health.camera.model ?? "-"})` : `OFF ${health.camera.lastError ?? ""}`) : "..."}
            </p>
            <p>{t("staff.printer")}: {health?.printer.state ?? "..."}</p>
            <p>{t("staff.queue")}: {health ? `${health.queue.pending} / gagal ${health.queue.failed}` : "..."}</p>
            <p data-testid="staff-counters">
              {t("staff.paper")}: {health?.counters.paper ?? "-"} · {t("staff.ink")}: {health?.counters.ink ?? "-"}
            </p>
            {msg ? <p data-testid="staff-message" className="mt-3 rounded-xl bg-brand-yellow/30 px-4 py-3 text-lg font-bold">{msg}</p> : null}
          </section>

          <section className="space-y-3 rounded-2xl border border-brand-green-dark/10 p-5">
            <button
              type="button"
              data-testid="staff-camera-reset"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await agent.cameraReset(token);
                  if (r.ok && sessionId) onResume();
                  return r.ok ? t("staff.done") : (r.camera.lastError ?? "camera reset gagal");
                })
              }
              className="w-full rounded-xl bg-brand-green-dark px-5 py-4 text-lg font-bold text-white disabled:opacity-60"
            >
              {t("staff.camera_reset")}
            </button>
            {sessionId ? (
              <button
                type="button"
                data-testid="staff-cancel-voucher"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await agent.cancelVoucher(token, sessionId);
                    onSessionCancelled();
                    return t("staff.voucher_code", { code: r.code });
                  })
                }
                className="w-full rounded-xl bg-brand-orange px-5 py-4 text-lg font-bold text-white disabled:opacity-60"
              >
                {t("staff.cancel_voucher")}
              </button>
            ) : null}
            <div className="grid grid-cols-3 gap-2">
              {[18, 36].map((n) => (
                <button key={n} type="button" data-testid={`staff-paper-${n}`} disabled={busy} onClick={() => run(async () => void (await agent.counters(token, { paperAdd: n })))} className="rounded-xl bg-brand-green-dark/10 px-3 py-3 font-semibold">
                  {t("staff.paper_add", { n })}
                </button>
              ))}
              <button type="button" data-testid="staff-ink" disabled={busy} onClick={() => run(async () => void (await agent.counters(token, { inkSet: 36 })))} className="rounded-xl bg-brand-green-dark/10 px-3 py-3 font-semibold">
                {t("staff.ink_set")}
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-brand-green-dark/10 p-5 lg:col-span-2">
            <h3 className="mb-3 text-lg font-bold">{t("staff.reprint")}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {sessions.map((s) => (
                <div key={s.id} data-testid="staff-session" className="space-y-2 rounded-xl border border-brand-green-dark/10 p-2">
                  <img src={s.compositeUrl} alt={s.id} className="aspect-[2/3] w-full rounded object-cover" />
                  <div className="flex gap-1">
                    {([1, 2] as const).map((sheet) => (
                      <button key={sheet} type="button" data-testid={`staff-reprint-${s.id}-${sheet}`} disabled={busy} onClick={() => run(async () => void (await agent.reprint(token, { sessionId: s.id, sheet })))} className="flex-1 rounded bg-brand-green-dark/10 py-1 text-xs font-semibold">
                        {t("staff.sheet", { n: sheet })}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
