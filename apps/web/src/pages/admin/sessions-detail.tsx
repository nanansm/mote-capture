import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { SessionStatus } from "@capture/shared";
import { SESSION_STATUS, SESSION_STATUS_VARIANT } from "@capture/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionActions } from "@/components/admin/session-actions";
import { formatDate, formatRupiah } from "@/lib/utils";
import { displayUrl } from "@/lib/storage/r2-client";
import { ApiError, get } from "@/lib/api";

// Ported from apps/cloud/app/admin/sessions/[id]/page.tsx. Field selection
// matches GET /api/admin/sessions/:id (apps/api/src/routes/admin-read.ts)
// exactly — that endpoint's shape was designed around this page.
type PhotoDto = { id: string; url: string; isFinal: boolean; sortOrder: number; createdAt: string };
type PaymentLogDto = {
  id: string;
  provider: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
};
type SessionDetailDto = {
  id: string;
  status: SessionStatus;
  boothId: string;
  boothName: string;
  amount: number;
  paymentProvider: string | null;
  paymentRef: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  createdAt: string;
  paidAt: string | null;
  printCompletedAt: string | null;
  downloadExpiresAt: string | null;
  shareUrl: string | null;
  frame: { id: string; name: string; tier: string; previewUrl: string | null } | null;
  photos: PhotoDto[];
  paymentLogs: PaymentLogDto[];
};

export default function SessionsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);

  const refetch = useCallback(() => {
    if (!id) return;
    get<{ data: SessionDetailDto }>(`/admin/sessions/${id}`)
      .then((res) => setData(res.data))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      });
  }, [id]);

  useEffect(() => {
    refetch();
    // `refetch` is stable per `id` (see useCallback above) — this effect
    // should only re-run when the route param itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (notFound) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Session tidak ditemukan.</p>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/sessions">← Kembali ke list</Link>
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{data.id}</p>
          <h2 className="text-xl font-semibold text-brand-green-dark">Detail Session</h2>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/sessions">← Kembali ke list</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={SESSION_STATUS_VARIANT[data.status]}>
              {SESSION_STATUS[data.status]}
            </Badge>
            <p className="mt-2 text-xs text-muted-foreground">Booth: {data.boothName}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-brand-green-dark">
              {formatRupiah(data.amount)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground capitalize">
              Provider: {data.paymentProvider ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <p>Dibuat: {formatDate(data.createdAt)}</p>
            <p>Dibayar: {formatDate(data.paidAt)}</p>
            <p>Selesai: {formatDate(data.printCompletedAt)}</p>
            <p>
              Link expire: {data.downloadExpiresAt ? formatDate(data.downloadExpiresAt) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Foto ({data.photos.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {data.photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada foto. Foto akan masuk dari bridge setelah pembayaran.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data.photos.map((p) => (
                <a
                  key={p.id}
                  href={displayUrl(p.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative block aspect-square overflow-hidden rounded-md border bg-muted"
                >
                  <img
                    src={displayUrl(p.url)}
                    alt={p.isFinal ? "Composite" : `Photo ${p.sortOrder}`}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                  {p.isFinal ? (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-brand-yellow px-2 py-0.5 text-[10px] font-semibold text-brand-green-dark">
                      Composite
                    </span>
                  ) : null}
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SessionActions
        sessionId={data.id}
        status={data.status}
        shareUrl={data.shareUrl ?? ""}
        initialPhone={data.customerPhone}
        initialEmail={data.customerEmail}
        onUpdated={refetch}
      />

      <Card>
        <CardHeader>
          <CardTitle>Payment Logs</CardTitle>
        </CardHeader>
        <CardContent>
          {data.paymentLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada log payment.</p>
          ) : (
            <ol className="space-y-3 border-l border-input pl-4">
              {data.paymentLogs.map((l) => (
                <li key={l.id} className="relative">
                  <span className="absolute -left-[19px] top-1 inline-block h-2.5 w-2.5 rounded-full bg-brand-green-dark" />
                  <p className="text-sm font-medium">{l.eventType}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(l.createdAt)} · {l.provider}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
