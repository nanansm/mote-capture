import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { KioskBootData } from "@capture/shared";
import { ApiError, get } from "@/lib/api";
import { KioskShell } from "@/components/kiosk/kiosk-shell";

type BootState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: KioskBootData };

// Fetches booth + frame catalog from GET /api/kiosk/boot (apps/api's
// src/routes/kiosk.ts) before rendering the kiosk state machine — a booth
// that doesn't exist or isn't active must show a friendly message here, not
// a blank/crashed screen, since this is what a physical touchscreen shows
// on boot with nobody around to read a stack trace.
export default function KioskPage() {
  const { boothId } = useParams<{ boothId: string }>();
  const [boot, setBoot] = useState<BootState>({ status: "loading" });

  useEffect(() => {
    if (!boothId) {
      setBoot({ status: "error", message: "Booth ID tidak ditemukan di URL." });
      return;
    }
    let active = true;
    setBoot({ status: "loading" });
    get<{ data: KioskBootData }>("/kiosk/boot", { params: { boothId } })
      .then((res) => {
        if (!active) return;
        setBoot({ status: "ready", data: res.data });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const message =
          err instanceof ApiError ? err.message : "Tidak bisa terhubung ke server. Coba lagi sebentar.";
        setBoot({ status: "error", message });
      });
    return () => {
      active = false;
    };
  }, [boothId]);

  if (boot.status === "loading") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-brand-cream text-brand-green-dark">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="text-sm font-medium text-brand-green-dark/70">Menyiapkan booth...</p>
      </div>
    );
  }

  if (boot.status === "error") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-brand-cream px-8 text-center text-brand-green-dark">
        <AlertTriangle className="h-12 w-12 text-brand-green-dark/60" />
        <h1 className="text-xl font-bold">Booth tidak bisa dibuka</h1>
        <p className="max-w-sm text-sm text-brand-green-dark/70">{boot.message}</p>
      </div>
    );
  }

  const { booth } = boot.data;

  return (
    <div className="fixed inset-0 overflow-hidden bg-brand-cream text-brand-green-dark">
      <KioskShell
        boothId={booth.id}
        boothName={booth.name}
        defaultPrice={booth.defaultPrice}
        useMockBridge={booth.useMockBridge}
        isActive={booth.isActive}
      />
    </div>
  );
}
