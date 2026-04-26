"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ExternalLink, RotateCcw, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminBoothStatuses } from "@/lib/socket/use-admin-socket";
import { formatDate } from "@/lib/utils";

export function BoothLiveStatus({
  boothId,
  metadata,
  lastSeenAt,
  appUrl,
}: {
  boothId: string;
  metadata: Record<string, unknown> | null;
  lastSeenAt: Date | null;
  appUrl: string;
}) {
  const router = useRouter();
  const statuses = useAdminBoothStatuses();
  const live = statuses[boothId];
  const [resetting, setResetting] = useState(false);

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
      router.refresh();
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
              {camera?.connected ? "🟢 Connected" : "⚪ Not reported"}
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
              {printer?.connected ? "🟢 Ready" : "⚪ Not reported"}
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
              href={`/admin/sessions/${sessionId}`}
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
