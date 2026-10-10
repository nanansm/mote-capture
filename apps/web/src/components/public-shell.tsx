import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// Shell halaman publik (beranda + halaman legal). Footer memuat alamat,
// kontak, dan tautan FAQ / Syarat & Ketentuan / Kebijakan Refund — syarat
// verifikasi domain dari iPaymu (dan payment gateway lain) untuk merchant.

export const CONTACT = {
  company: "PT Masyarakat Modal Tekun (Mote Kreatif)",
  email: "motekreatif@gmail.com",
  whatsappLabel: "+62 851-9655-8646",
  whatsappUrl: "https://wa.me/6285196558646",
  addresses: [
    "Jl. Raya Cipanas No.13, Cimanganten, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151",
    "Jl. Ahmad Yani Timur No.74, Lebakjaya, Kec. Karangpawitan, Kabupaten Garut, Jawa Barat 44182",
  ],
} as const;

export const LEGAL_LINKS: Array<[string, string]> = [
  ["FAQ", "/faq"],
  ["Syarat & Ketentuan", "/syarat-ketentuan"],
  ["Kebijakan Refund", "/kebijakan-refund"],
  ["Kontak", "/kontak"],
];

export function PublicHeader() {
  return (
    <header className="border-b border-zinc-200">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2.5">
          {/* The .webp is a square canvas with generous internal padding, so
              the drawn mark reads about a third smaller than the box. */}
          <img
            src="/wlogogramsquare.webp"
            alt=""
            width={40}
            height={40}
            className="h-9 w-9 shrink-0 sm:h-10 sm:w-10"
          />
          <span className="text-sm font-bold uppercase tracking-[0.18em]">Mote Capture</span>
        </Link>
        <Link
          to="/login"
          className="rounded-full px-4 py-2 text-sm font-semibold transition hover:bg-brand-cream"
        >
          Masuk Admin
        </Link>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-zinc-200">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-12 text-sm text-zinc-600 sm:grid-cols-3">
        <div>
          <p className="font-bold text-brand-green-dark">Capture by Mote Kreatif</p>
          <p className="mt-2 leading-relaxed">
            Layanan photobooth swafoto dengan pembayaran QRIS, dikelola {CONTACT.company}.
          </p>
          <p className="mt-3 leading-relaxed">
            Pembayaran diproses oleh payment gateway berizin Bank Indonesia (iPaymu, Xendit, DOKU).
          </p>
        </div>
        <div>
          <p className="font-bold text-brand-green-dark">Kontak</p>
          <ul className="mt-2 space-y-2">
            <li>
              WhatsApp{" "}
              <a className="underline" href={CONTACT.whatsappUrl}>
                {CONTACT.whatsappLabel}
              </a>
            </li>
            <li>
              Email{" "}
              <a className="underline" href={`mailto:${CONTACT.email}`}>
                {CONTACT.email}
              </a>
            </li>
            {CONTACT.addresses.map((a) => (
              <li key={a} className="leading-relaxed">
                {a}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-bold text-brand-green-dark">Informasi</p>
          <ul className="mt-2 space-y-2">
            {LEGAL_LINKS.map(([label, href]) => (
              <li key={href}>
                <Link className="underline" to={href}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-zinc-200">
        <p className="mx-auto max-w-5xl px-6 py-5 text-xs text-zinc-500">
          © 2026 {CONTACT.company}. Semua hak dilindungi.
        </p>
      </div>
    </footer>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-brand-green-dark">
      <PublicHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6">{children}</main>
      <PublicFooter />
    </div>
  );
}
