import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Download Bridge — Capture by Mote Kreatif",
  description: "Installer Mote Capture Bridge untuk PC booth (Windows).",
};

const STEPS = [
  'Buka file yang ter-download, klik "More info" → "Run anyway" jika muncul layar biru Windows.',
  "Klik Next → Next → Install (izinkan satu kali permintaan admin untuk digiCamControl).",
  "Setelah jendela konfigurasi terbuka, isi Cloud URL dan Bridge Token booth ini.",
  'Centang "Launch on system startup", lalu Save. Status berubah menjadi Online.',
];

export default function DownloadPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-brand-green-dark">
          Mote Capture Bridge
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Installer untuk PC booth · Windows 64-bit · ±169 MB
        </p>
      </div>

      <a
        href="/api/download/bridge"
        className="rounded-full bg-brand-green-dark px-8 py-4 text-base font-semibold text-white shadow-sm transition hover:opacity-90"
      >
        ⬇ Download Installer (.exe)
      </a>

      <div className="w-full rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-green-dark">
          Cara pasang
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-700">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          Cloud URL: <code>https://capture.motekreatif.com</code>. Bridge Token
          diambil dari menu Booth di dashboard admin (satu token per booth).
        </p>
      </div>
    </main>
  );
}
