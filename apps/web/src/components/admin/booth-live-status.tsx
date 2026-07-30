import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ExternalLink, RotateCcw, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminBoothStatuses } from "@/lib/ws/use-admin-booth-statuses";
import { formatDate } from "@/lib/utils";
import { get } from "@/lib/api";

// Treat heartbeat metadata as fresh for 90s after last receive. Bridge sends
// a heartbeat every 30s, so a 90s window allows up to 2 missed pings before
// we mark the camera/printer as "Not reported" (avoiding flicker on a single
// late packet).
const BOOTH_HEARTBEAT_VALID_MS = 90_000;
// Pull fresh metadata from the server every 10s. The socket broadcasts
// already cover online/offline transitions live; this catches camera/printer
// status changes that only show up via the next heartbeat write.
const ADMIN_REFRESH_INTERVAL_MS = 10_000;

type BoothRow = {
  metadata: Record<string, unknown> | null;
  lastSeenAt: string | null;
};

export function BoothLiveStatus({
  boothId,
  metadata: initialMetadata,
  lastSeenAt: initialLastSeenAt,
  appUrl,
}: {
  boothId: string;
  metadata: Record<string, unknown> | null;
  lastSeenAt: Date | null;
  appUrl: string;
}) {
  const statuses = useAdminBoothStatuses();
  const live = statuses[boothId];
  const [resetting, setResetting] = useState(false);
  const [metadata, setMetadata] = useState(initialMetadata);
  const [lastSeenAt, setLastSeenAt] = useState(initialLastSeenAt);

  // Re-runs `GET /api/booths/:id` in place — this used to call
  // `router.refresh()` to re-execute the Next.js server component and pull
  // fresh `metadata`/`lastSeenAt`. The WS push (`useAdminBoothStatuses`)
  // already covers online/offline transitions live; this polling loop
  // catches camera/printer status changes that only show up via the next
  // heartbeat write to `booths.metadata`.
  const refetch = useCallback(async () => {
    try {
      const res = await get<{ data: BoothRow }>(`/booths/${boothId}`);
      setMetadata(res.data.metadata);
      setLastSeenAt(res.data.lastSeenAt ? new Date(res.data.lastSeenAt) : null);
    } catch {
      // Best-effort background refresh — a transient failure just keeps
      // showing the last known state until the next tick succeeds.
    }
  }, [boothId]);

  useEffect(() => {
    const id = window.setInterval(refetch, ADMIN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refetch]);

  const camera = useMemo(() => {
    const c = (metadata?.camera ?? {}) as {
      connected?: boolean;
      model?: string;
      deviceName?: string;
      mode?: string;
      error?: string;
    };
    return { ...c, model: c.model ?? c.deviceName };
  }, [metadata]);
  const printer = useMemo(() => {
    const p = (metadata?.printer ?? {}) as {
      connected?: boolean;
      model?: string;
      deviceName?: string;
      mode?: string;
      paperRemaining?: number;
      error?: string;
    };
    return { ...p, model: p.model ?? p.deviceName };
  }, [metadata]);

  const connected = Boolean(live?.online ?? live?.bridgeOnline);
  const inSession = Boolean(live?.inSession);
  const sessionId = live?.activeSessionId;
  const useMockBridge = (metadata?.use_mock_bridge as boolean | undefined) ?? true;

  // Heartbeat metadata older than the valid window is treated as unknown so
  // the camera/printer status doesn't lie about being connected after the
  // bridge has gone away.
  const heartbeatFresh =
    !!lastSeenAt && Date.now() - lastSeenAt.getTime() < BOOTH_HEARTBEAT_VALID_MS;
  const cameraConnected = heartbeatFresh && Boolean(camera?.connected);
  const printerConnected = heartbeatFresh && Boolean(printer?.connected);

  async function handleForceReset() {
    if (!sessionId) {
      toast.error("Tidak ada session aktif");
      return;
    }
    if (!confirm(`Force reset session ${sessionId}? Kiosk akan kembali ke layar awal.`)) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/reset`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Gagal reset");
        return;
      }
      toast.success("Session di-reset");
      void refetch();
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {connected ? (
            <Wifi className="h-5 w-5 text-brand-green-light" />
          ) : (
            <WifiOff className="h-5 w-5 text-muted-foreground" />
          )}
          Live Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {connected ? (
            inSession ? (
              <Badge variant="warn">🟡 Sesi Aktif</Badge>
            ) : (
              <Badge variant="success">🟢 Online</Badge>
            )
          ) : lastSeenAt ? (
            <Badge variant="destructive">🔴 Offline</Badge>
          ) : (
            <Badge variant="outline">⚪ Belum pernah connect</Badge>
          )}
          {lastSeenAt ? (
            <span className="text-xs text-muted-foreground">
              Last seen {formatDate(lastSeenAt)}
            </span>
          ) : null}
          {useMockBridge ? (
            <Badge variant="outline">🧪 Mock Bridge</Badge>
          ) : (
            <Badge variant="warn">🔌 Real Bridge</Badge>
          )}
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-md border border-input p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Camera</p>
            <p className="font-semibold text-brand-green-dark">
              {cameraConnected ? "🟢 Connected" : "⚪ Not reported"}
            </p>
            {camera?.model ? (
              <p className="text-xs text-muted-foreground">{camera.model}</p>
            ) : null}
            {camera?.mode ? (
              <p className="text-xs text-muted-foreground">mode: {camera.mode}</p>
            ) : null}
            {camera?.error ? (
              <p className="text-xs text-destructive">{camera.error}</p>
            ) : null}
          </div>
          <div className="rounded-md border border-input p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Printer</p>
            <p className="font-semibold text-brand-green-dark">
              {printerConnected ? "🟢 Ready" : "⚪ Not reported"}
            </p>
            {printer?.model ? (
              <p className="text-xs text-muted-foreground">{printer.model}</p>
            ) : null}
            {printer?.mode ? (
              <p className="text-xs text-muted-foreground">mode: {printer.mode}</p>
            ) : null}
            {typeof printer?.paperRemaining === "number" ? (
              <p className="text-xs text-muted-foreground">
                Paper: {printer.paperRemaining}%
              </p>
            ) : null}
            {printer?.error ? (
              <p className="text-xs text-destructive">{printer.error}</p>
            ) : null}
          </div>
        </div>

        {sessionId ? (
          <div className="rounded-md border border-input bg-muted/40 p-3 text-sm">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Active Session
            </p>
            <Link
              to={`/admin/sessions/${sessionId}`}
              className="font-mono text-sm text-brand-green-dark hover:underline"
            >
              {sessionId}
            </Link>
            {live?.activeSessionStatus ? (
              <span className="ml-2 text-xs text-muted-foreground">
                ({live.activeSessionStatus})
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`${appUrl}/kiosk/${boothId}`} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open Kiosk
            </a>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleForceReset}
            disabled={resetting || !sessionId}
          >
            {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Force Reset Session
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
