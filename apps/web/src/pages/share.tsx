import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { zipSync } from "fflate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { displayUrl } from "@/lib/storage/r2-client";
import { ApiError, get } from "@/lib/api";

// Ported from apps/cloud/app/share/[token]/page.tsx (PUBLIC — no auth) onto
// GET /api/share/:token (apps/api/src/routes/share.ts). That endpoint keeps
// the old page's three "can't show photos yet" states but as real HTTP
// statuses instead of an inline state card:
//   404 unknown token / 410 expired / 425 session not done yet.
//
// The old page's "Download Semua (.zip)" button hit a server route
// (apps/cloud/app/api/share/[token]/zip/route.ts) that streamed a zip built
// with a Node zip library — no Workers equivalent, and too CPU-heavy for
// the Workers Free 10ms/request budget anyway (see apps/api/src/routes/
// share.ts's file header). That route was deleted; this page instead fetches
// every photo URL client-side and zips them in the browser with `fflate`.
type PhotoDto = { id: string; url: string; isFinal: boolean; sortOrder: number };
type ShareData = {
  session: { id: string; boothName: string; downloadExpiresAt: string | null };
  photos: PhotoDto[];
};

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "expired"; downloadExpiresAt: string | null }
  | { kind: "not_ready" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ShareData };

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-dvh w-full overflow-hidden bg-brand-cream">
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 blob-yellow" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-[28rem] w-[28rem] blob-pink" />
      <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="w-full max-w-[600px]">{children}</div>
      </div>
    </main>
  );
}

function StateCard({
  emoji,
  title,
  description,
}: {
  emoji: string;
  title: string;
  description: string;
}) {
  return (
    <Card className="border-brand-green-dark/10 shadow-xl">
      <CardContent className="space-y-4 px-8 py-12 text-center">
        <div className="text-5xl">{emoji}</div>
        <h1 className="text-2xl font-semibold text-brand-green-dark">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function extensionFromUrl(url: string): string {
  const clean = url.split("?")[0] ?? url;
  const ext = clean.split(".").pop();
  return ext && ext.length <= 5 ? ext : "jpg";
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    get<ShareData>(`/share/${token}`)
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setState({ kind: "not_found" });
            return;
          }
          if (err.status === 410) {
            const body = err.body as { downloadExpiresAt?: string } | null;
            setState({ kind: "expired", downloadExpiresAt: body?.downloadExpiresAt ?? null });
            return;
          }
          if (err.status === 425) {
            setState({ kind: "not_ready" });
            return;
          }
        }
        setState({ kind: "error", message: "Gagal memuat foto. Coba refresh halaman ini." });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleDownloadAll(data: ShareData) {
    setZipping(true);
    try {
      const entries: Record<string, Uint8Array> = {};
      await Promise.all(
        data.photos.map(async (p, i) => {
          const res = await fetch(displayUrl(p.url));
          if (!res.ok) throw new Error(`Gagal mengunduh foto ${i + 1}`);
          const buf = new Uint8Array(await res.arrayBuffer());
          const ext = extensionFromUrl(p.url);
          const base = p.isFinal ? "composite" : "foto";
          entries[`${base}-${i + 1}.${ext}`] = buf;
        }),
      );
      const zipped = zipSync(entries);
      const blob = new Blob([zipped], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mote-capture-${data.session.id}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal membuat file zip");
    } finally {
      setZipping(false);
    }
  }

  if (state.kind === "loading") {
    return <Layout>{null}</Layout>;
  }

  if (state.kind === "not_found") {
    return (
      <Layout>
        <StateCard
          emoji="🔍"
          title="Link tidak valid"
          description="Link download yang kamu buka tidak ditemukan. Coba minta operator booth untuk kirim ulang ya."
        />
      </Layout>
    );
  }

  if (state.kind === "expired") {
    return (
      <Layout>
        <StateCard
          emoji="⌛"
          title="Link sudah expired"
          description={
            state.downloadExpiresAt
              ? `Link berlaku sampai ${formatDate(state.downloadExpiresAt)}. Hubungi Maja Photobooth kalau masih butuh fotonya.`
              : "Hubungi Maja Photobooth kalau masih butuh fotonya."
          }
        />
      </Layout>
    );
  }

  if (state.kind === "not_ready") {
    return (
      <Layout>
        <StateCard
          emoji="⏳"
          title="Foto belum siap"
          description="Foto kamu masih diproses. Coba refresh halaman ini sebentar lagi."
        />
      </Layout>
    );
  }

  if (state.kind === "error") {
    return (
      <Layout>
        <StateCard emoji="⚠️" title="Terjadi kesalahan" description={state.message} />
      </Layout>
    );
  }

  const { data } = state;
  const composite = data.photos.find((p) => p.isFinal);
  const individual = data.photos.filter((p) => !p.isFinal);

  return (
    <Layout>
      <Card className="border-brand-green-dark/10 shadow-xl">
        <CardContent className="space-y-6 px-6 py-10 text-center sm:px-10">
          <div className="flex flex-col items-center gap-3">
            <img
              src="/wlogogramsquare.webp"
              alt="Mote Kreatif"
              width={64}
              height={64}
              className="rounded-2xl"
            />
            <h1 className="text-2xl font-semibold text-brand-green-dark">
              Foto Kamu Sudah Siap! 📸
            </h1>
            <p className="text-sm text-muted-foreground">
              Terima kasih sudah berfoto. Download di bawah ini.
            </p>
          </div>

          {individual.length > 0 ? (
            <div className="grid grid-cols-3 gap-3">
              {individual.slice(0, 6).map((p, i) => (
                <a
                  key={p.id}
                  href={displayUrl(p.url)}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="group block overflow-hidden rounded-xl border border-brand-green-dark/10 bg-muted shadow-sm"
                >
                  <div className="relative aspect-square">
                    <img
                      src={displayUrl(p.url)}
                      alt={`Foto ${i + 1}`}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </div>
                  <p className="bg-white/80 py-1.5 text-xs font-medium text-brand-green-dark">
                    Foto {i + 1}
                  </p>
                </a>
              ))}
            </div>
          ) : null}

          <div className="space-y-2">
            {composite ? (
              <Button asChild variant="brand" size="lg" className="w-full">
                <a href={displayUrl(composite.url)} download target="_blank" rel="noreferrer">
                  Download Komposit
                </a>
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              disabled={zipping || data.photos.length === 0}
              onClick={() => handleDownloadAll(data)}
            >
              {zipping ? "Menyiapkan zip..." : "Download Semua (.zip)"}
            </Button>
          </div>

          {data.session.downloadExpiresAt ? (
            <p className="text-xs text-muted-foreground">
              Link berlaku sampai{" "}
              <strong className="text-brand-green-dark">
                {formatDate(data.session.downloadExpiresAt)}
              </strong>
              .
            </p>
          ) : null}

          <p className="text-[11px] text-muted-foreground">
            <a
              href="https://motekreatif.com"
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              Capture by Mote Kreatif
            </a>
          </p>
        </CardContent>
      </Card>
    </Layout>
  );
}
