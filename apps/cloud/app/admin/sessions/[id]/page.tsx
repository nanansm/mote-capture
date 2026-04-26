import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SessionActions } from "@/components/admin/session-actions";
import { formatDate, formatRupiah } from "@/lib/utils";
import { env } from "@/lib/env";
import { SESSION_STATUS, SESSION_STATUS_VARIANT, type SessionStatus } from "@capture/shared";
import { displayUrl } from "@/lib/storage/r2-client";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!session) notFound();

  const [booth] = session.boothId
    ? await db
        .select({ id: schema.booths.id, name: schema.booths.name })
        .from(schema.booths)
        .where(eq(schema.booths.id, session.boothId))
        .limit(1)
    : [];

  const [photos, logs] = await Promise.all([
    db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.sessionId, session.id))
      .orderBy(asc(schema.photos.sortOrder)),
    db
      .select()
      .from(schema.paymentLogs)
      .where(eq(schema.paymentLogs.sessionId, session.id))
      .orderBy(desc(schema.paymentLogs.createdAt)),
  ]);

  const shareUrl = session.downloadToken
    ? `${env.NEXT_PUBLIC_APP_URL}/share/${session.downloadToken}`
    : "";

  const status = session.status as SessionStatus;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{session.id}</p>
          <h2 className="text-xl font-semibold text-brand-green-dark">
            Detail Session
          </h2>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/sessions">← Kembali ke list</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={SESSION_STATUS_VARIANT[status]}>{SESSION_STATUS[status]}</Badge>
            <p className="mt-2 text-xs text-muted-foreground">
              Booth: {booth?.name ?? session.boothId}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-brand-green-dark">
              {formatRupiah(session.amount)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground capitalize">
              Provider: {session.paymentProvider ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <p>Dibuat: {formatDate(session.createdAt)}</p>
            <p>Dibayar: {formatDate(session.paidAt)}</p>
            <p>Selesai: {formatDate(session.printCompletedAt)}</p>
            <p>
              Link expire:{" "}
              {session.downloadExpiresAt ? formatDate(session.downloadExpiresAt) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Foto ({photos.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada foto. Foto akan masuk dari bridge setelah pembayaran.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {photos.map((p) => (
                <a
                  key={p.id}
                  href={displayUrl(p.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative block aspect-square overflow-hidden rounded-md border bg-muted"
                >
                  <Image
                    src={displayUrl(p.url)}
                    alt={p.isFinal ? "Composite" : `Photo ${p.sortOrder}`}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    sizes="(min-width: 640px) 25vw, 50vw"
                    unoptimized
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
        sessionId={session.id}
        status={status}
        shareUrl={shareUrl}
        initialPhone={session.customerPhone}
        initialEmail={session.customerEmail}
      />

      <Card>
        <CardHeader>
          <CardTitle>Payment Logs</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada log payment.</p>
          ) : (
            <ol className="space-y-3 border-l border-input pl-4">
              {logs.map((l) => (
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
