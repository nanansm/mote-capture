import { Link } from "react-router-dom";

// Public setup guide. This route used to redirect straight to /admin, so
// anyone opening the bare domain — including a booth operator who only needs
// the installer — landed on a login form with no explanation.
//
// The audience is the person setting up a booth. The content deliberately
// spells out the parts that are NOT automatic: the bridge ships with camera
// and printer in mock mode, and digiCamControl needs a one-time manual
// setting. A booth that skips those looks Online in the dashboard while
// shooting placeholder images — so each phase ends with something to verify.

type Step = { title: string; body: string; note?: string };

const PHASES: Array<{
  label: string;
  where: string;
  steps: Step[];
}> = [
  {
    label: "Bagian 1",
    where: "Di dashboard, bisa dari HP atau laptop",
    steps: [
      {
        title: "Buat booth",
        body: "Admin → Booth → Tambah Booth. Isi nama, lokasi, dan harga. Setelah tersimpan, buka booth itu dan salin Bridge Token-nya. Satu booth satu token — jangan dipakai bergantian di dua PC.",
      },
      {
        title: "Unggah frame",
        body: "Admin → Frame → Tambah Frame. File PNG 1800×1200 piksel, dan area foto harus transparan karena frame ditimpa di atas foto saat dicetak.",
      },
    ],
  },
  {
    label: "Bagian 2",
    where: "Di PC booth, sekali saja",
    steps: [
      {
        title: "Jalankan installer",
        body: "Download file .exe, klik dua kali, lalu Next sampai selesai. Windows menampilkan layar biru SmartScreen — pilih More info, lalu Run anyway. Akan muncul satu permintaan izin admin untuk memasang digiCamControl; izinkan.",
        note: "Bagian ini memang tinggal klik lanjut. Yang butuh perhatian ada di tiga langkah berikutnya.",
      },
      {
        title: "Tab Setup — sambungkan ke cloud",
        body: "Jendela konfigurasi terbuka sendiri setelah instalasi. Cloud URL sudah terisi. Tempel Bridge Token, centang Launch on system startup, lalu Save. Booth ID terisi otomatis dan status booth berubah jadi Online di dashboard.",
      },
      {
        title: "Tab Camera — ganti dari Mock",
        body: "Setelah dipasang, Mode masih “Mock (SVG placeholder)”. Ubah jadi “Canon via digiCamControl (Windows)”. Biarkan path dan Session folder apa adanya kecuali digiCamControl dipasang di lokasi lain. Save, lalu klik Test.",
        note: "Kalau dilewati, booth tetap Online tapi yang difoto adalah gambar contoh, bukan tamu kamu.",
      },
      {
        title: "Tab Printer — ganti dari Mock",
        body: "Mode juga masih “Mock”. Ubah jadi “Windows (mspaint /pt)”, pilih printer kamu dari daftar, Save, lalu klik Test. Pastikan ukuran kertas 4R sudah jadi bawaan di pengaturan driver printer-nya.",
        note: "Dalam mode Mock, hasil cetak cuma jadi file PNG di folder Downloads dan tidak ada kertas yang keluar.",
      },
    ],
  },
  {
    label: "Bagian 3",
    where: "Di aplikasi digiCamControl, sekali saja",
    steps: [
      {
        title: "Nyalakan webserver kamera",
        body: "Buka digiCamControl → Settings → Webserver → aktifkan, port 5513. Ini yang dipakai layar booth untuk menampilkan preview kamera secara langsung.",
      },
      {
        title: "Buka sesi bernama Session1",
        body: "Di digiCamControl, buat atau buka sesi dengan nama persis Session1. Bridge membaca foto hasil jepretan dari folder sesi ini.",
        note: "Dua pengaturan ini tidak bisa diisikan otomatis oleh installer karena berbeda antar versi digiCamControl.",
      },
    ],
  },
  {
    label: "Bagian 4",
    where: "Sebelum booth dibuka untuk umum",
    steps: [
      {
        title: "Restart PC",
        body: "Setelah reboot, digiCamControl, bridge, dan layar kiosk Edge harus menyala sendiri tanpa disentuh. Kalau salah satu tidak muncul, konfigurasinya belum tersimpan.",
      },
      {
        title: "Jalankan satu sesi percobaan",
        body: "Buka shortcut “Mote Capture Booth” di Desktop, lalu jalankan satu sesi sampai kertas keluar. Turunkan dulu harga frame ke nominal kecil supaya pembayaran QRIS-nya bisa benar-benar dicoba, lalu kembalikan ke harga normal.",
      },
    ],
  },
];

const CHECKS: Array<[string, string]> = [
  ["Kamera", "Canon atau Nikon DSLR tersambung USB. digiCamControl ikut terpasang dari installer."],
  ["Printer", "Printer foto biasa, kertas 4R. Tidak perlu auto-cutter."],
  ["PC booth", "Windows 64-bit dengan Microsoft Edge, dan internet yang stabil."],
  ["Pembayaran", "QRIS lewat Xendit — GoPay, OVO, DANA, ShopeePay, dan mobile banking."],
];

const TROUBLE: Array<[string, string]> = [
  [
    "Booth tertulis Offline di dashboard",
    "Bridge belum jalan atau token salah tempel. Buka bridge dari tray, cek tab Setup, pastikan token sama persis dengan yang ada di halaman booth.",
  ],
  [
    "Preview kamera hitam atau kosong",
    "Webserver digiCamControl belum aktif, atau sesi Session1 belum dibuka. Ulangi Bagian 3.",
  ],
  [
    "Sesi selesai tapi tidak ada kertas keluar",
    "Printer masih di mode Mock — cek folder Downloads, kalau hasil cetaknya mendarat di situ sebagai PNG berarti benar. Ubah Mode di tab Printer, lalu Test.",
  ],
  [
    "Foto yang keluar bukan wajah tamu",
    "Kamera masih di mode Mock. Ubah Mode di tab Camera jadi digiCamControl, lalu Test.",
  ],
];

const ADDRESSES: Array<[string, string]> = [
  ["Dashboard admin", "/admin"],
  ["Halaman download", "/download"],
  ["Layar booth", "/kiosk/<ID-BOOTH>"],
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-brand-green-dark">
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <span className="flex items-center gap-2.5">
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
          </span>
          <Link
            to="/login"
            className="rounded-full px-4 py-2 text-sm font-semibold transition hover:bg-brand-cream"
          >
            Masuk Admin
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="py-16 sm:py-24">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Panduan pemasangan booth
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-[1.1] sm:text-5xl">
            Dari PC kosong sampai kertas foto keluar.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-600">
            Pemasangan file installer-nya memang tinggal klik lanjut. Yang butuh perhatian adalah
            konfigurasi setelahnya — bridge sengaja dikirim dalam mode uji, jadi kamera dan printer
            harus dinyalakan manual sekali. Ikuti empat bagian di bawah sampai habis.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              href="/download"
              className="rounded-full bg-brand-green-dark px-7 py-4 text-center text-base font-semibold text-white transition hover:opacity-90"
            >
              Download Bridge untuk Windows
            </a>
            <Link
              to="/login"
              className="rounded-full border border-zinc-300 px-7 py-4 text-center text-base font-semibold transition hover:bg-brand-cream"
            >
              Buka Dashboard Admin
            </Link>
          </div>
        </section>

        {PHASES.map((phase) => (
          <section key={phase.label} className="border-t border-zinc-200 py-14">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {phase.label}
            </p>
            <h2 className="mt-2 text-2xl font-bold sm:text-3xl">{phase.where}</h2>

            <ol className="mt-9 space-y-9">
              {phase.steps.map((step, i) => (
                <li key={step.title} className="flex flex-col gap-4 sm:flex-row sm:gap-7">
                  <span
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-yellow text-lg font-bold"
                  >
                    {i + 1}
                  </span>
                  <div className="max-w-2xl">
                    <h3 className="text-xl font-bold">{step.title}</h3>
                    <p className="mt-2 text-base leading-relaxed text-zinc-600">{step.body}</p>
                    {step.note ? (
                      <p className="mt-3 rounded-xl bg-brand-cream px-4 py-3 text-base leading-relaxed text-zinc-700">
                        {step.note}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}

        <section className="border-t border-zinc-200 py-14">
          <h2 className="text-2xl font-bold sm:text-3xl">Yang perlu disiapkan</h2>
          <dl className="mt-9 grid gap-6 sm:grid-cols-2">
            {CHECKS.map(([label, body]) => (
              <div key={label} className="rounded-2xl bg-brand-cream p-6">
                <dt className="text-sm font-bold uppercase tracking-[0.12em]">{label}</dt>
                <dd className="mt-2 text-base leading-relaxed text-zinc-700">{body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-t border-zinc-200 py-14">
          <h2 className="text-2xl font-bold sm:text-3xl">Kalau ada yang tidak beres</h2>
          <dl className="mt-9 space-y-8">
            {TROUBLE.map(([symptom, fix]) => (
              <div key={symptom} className="max-w-3xl">
                <dt className="text-lg font-bold">{symptom}</dt>
                <dd className="mt-2 text-base leading-relaxed text-zinc-600">{fix}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-t border-zinc-200 py-14">
          <h2 className="text-2xl font-bold sm:text-3xl">Alamat penting</h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-zinc-600">
            ID booth bisa dilihat di halaman Booth pada dashboard.
          </p>
          {/* space-y-px over a zinc background draws the dividers, so the rounded
              corners stay clean instead of a border cutting across them. */}
          <div className="mt-8 space-y-px overflow-hidden rounded-2xl bg-zinc-200">
            {ADDRESSES.map(([label, path]) => (
              <div
                key={label}
                className="flex flex-col gap-1 bg-white px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-semibold">{label}</span>
                <code className="break-all font-mono text-sm text-zinc-600">
                  capture.motekreatif.com{path}
                </code>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200">
        <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-zinc-500">
          Capture by Mote Kreatif
        </div>
      </footer>
    </div>
  );
}
