import Image from "next/image";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { displayUrl } from "@/lib/storage/r2-client";

export const dynamic = "force-dynamic";

function Layout({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main className="relative min-h-dvh w-full overflow-hidden bg-brand-cream">
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 blob-yellow" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-[28rem] w-[28rem] blob-pink" />
      <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-10">
        <div className={`w-full max-w-[600px] ${className}`}>{children}</div>
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

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.downloadToken, token))
    .limit(1);

  if (!session) {
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

  if (session.downloadExpiresAt && session.downloadExpiresAt.getTime() < Date.now()) {
    return (
      <Layout>
        <StateCard
          emoji="⌛"
          title="Link sudah expired"
          description={`Link berlaku sampai ${formatDate(session.downloadExpiresAt)}. Hubungi Maja Photobooth kalau masih butuh fotonya.`}
        />
      </Layout>
    );
  }

  if (session.status !== "done") {
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

  const photos = await db
    .select()
    .from(schema.photos)
    .where(eq(schema.photos.sessionId, session.id))
    .orderBy(schema.photos.sortOrder);
  const composite = photos.find((p) => p.isFinal);
  const individual = photos.filter((p) => !p.isFinal);
  const zipHref = `/api/share/${token}/zip`;

  return (
    <Layout>
      <Card className="border-brand-green-dark/10 shadow-xl">
        <CardContent className="space-y-6 px-6 py-10 text-center sm:px-10">
          <div className="flex flex-col items-center gap-3">
            <Image
              src="/wlogogramsquare.webp"
              alt="Mote Kreatif"
              width={64}
              height={64}
              className="rounded-2xl"
              priority
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
                    <Image
                      src={displayUrl(p.url)}
                      alt={`Foto ${i + 1}`}
                      fill
                      className="object-cover transition-transform group-hover:scale-105"
                      sizes="(min-width: 640px) 180px, 30vw"
                      unoptimized
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
            <Button asChild variant="outline" size="lg" className="w-full">
              <a href={zipHref} download>
                Download Semua (.zip)
              </a>
            </Button>
          </div>

          {session.downloadExpiresAt ? (
            <p className="text-xs text-muted-foreground">
              Link berlaku sampai{" "}
              <strong className="text-brand-green-dark">
                {formatDate(session.downloadExpiresAt)}
              </strong>
              .
            </p>
          ) : null}

          <p className="text-[11px] text-muted-foreground">
            <Link href="https://motekreatif.com" target="_blank" className="hover:underline">
              Maja Photobooth × Mote Kreatif
            </Link>
          </p>
        </CardContent>
      </Card>
    </Layout>
  );
}
