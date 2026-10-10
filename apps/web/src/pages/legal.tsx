import { Link } from "react-router-dom";
import { CONTACT, PublicShell } from "@/components/public-shell";

// Halaman legal publik: FAQ, Syarat & Ketentuan, Kebijakan Refund, Kontak.
// Isi mengikuti perilaku sistem yang sebenarnya (voucher otomatis saat sesi
// berbayar gagal, link unduh berlaku DOWNLOAD_LINK_EXPIRY_DAYS = 7 hari).
// Kalau perilaku itu berubah, teks di sini wajib ikut diubah.

type Block = { title: string; body: string[] };

const UPDATED = "Oktober 2026";

const FAQ: Block[] = [
  {
    title: "Apa itu Mote Capture?",
    body: [
      "Mote Capture adalah layanan photobooth swafoto yang dipasang di kafe, restoran, dan acara. Kamu memilih frame, membayar lewat QRIS, berfoto, lalu hasilnya langsung dicetak dan bisa diunduh lewat HP.",
    ],
  },
  {
    title: "Bagaimana cara membayar?",
    body: [
      "Di layar booth, pilih frame lalu pindai kode QRIS yang muncul memakai aplikasi e-wallet (GoPay, OVO, DANA, ShopeePay, LinkAja) atau mobile banking. Sesi foto otomatis dimulai setelah pembayaran terkonfirmasi.",
      "Pembayaran diproses oleh payment gateway berizin Bank Indonesia (iPaymu, Xendit, atau DOKU, tergantung booth). Mote Capture tidak pernah meminta PIN, kata sandi, atau data kartu kamu.",
    ],
  },
  {
    title: "Berapa harganya?",
    body: [
      "Harga tertera di layar booth sebelum kamu membayar dan bisa berbeda tiap lokasi. Nominal yang muncul di QRIS sama dengan harga di layar.",
    ],
  },
  {
    title: "Saya sudah bayar tapi sesi foto tidak mulai. Bagaimana?",
    body: [
      "Kalau pembayaran sudah terpotong tapi sesi tidak berjalan (misalnya pembayaran terkonfirmasi setelah waktu habis, atau booth bermasalah), sistem otomatis menerbitkan voucher senilai pembayaran kamu. Voucher bisa dipakai untuk sesi berikutnya di booth tersebut.",
      "Kalau voucher tidak muncul, hubungi petugas di lokasi atau kontak kami di bawah dengan menyertakan waktu transaksi dan bukti bayar.",
    ],
  },
  {
    title: "Bagaimana cara mengunduh foto?",
    body: [
      "Setelah sesi selesai, layar booth menampilkan kode QR. Pindai dengan HP untuk membuka halaman unduhan. Link unduhan berlaku 7 hari sejak sesi selesai.",
    ],
  },
  {
    title: "Apakah foto saya disebarkan?",
    body: [
      "Tidak. Foto hanya bisa dibuka lewat link unik milik sesi kamu. Kami tidak memakai foto pelanggan untuk promosi tanpa izin.",
    ],
  },
];

const TERMS: Block[] = [
  {
    title: "1. Penyelenggara",
    body: [
      `Layanan Mote Capture (capture.motekreatif.com) diselenggarakan oleh ${CONTACT.company}, berkedudukan di Garut, Jawa Barat. Dengan memakai booth atau membayar sesi foto, kamu dianggap menyetujui ketentuan ini.`,
    ],
  },
  {
    title: "2. Layanan",
    body: [
      "Satu pembayaran berlaku untuk satu sesi foto sesuai frame yang dipilih, termasuk cetak foto dan link unduhan digital. Jumlah jepretan dan cetakan per sesi tertera di layar booth sebelum pembayaran.",
    ],
  },
  {
    title: "3. Pembayaran",
    body: [
      "Pembayaran dilakukan lewat QRIS yang diproses oleh payment gateway berizin Bank Indonesia. Harga sudah final saat QRIS ditampilkan. Kode QRIS punya batas waktu; setelah lewat, buat sesi baru.",
      "Pembayaran dianggap sah setelah dikonfirmasi oleh payment gateway, bukan berdasarkan tangkapan layar.",
    ],
  },
  {
    title: "4. Penggunaan booth",
    body: [
      "Pengguna wajib memakai booth dengan wajar dan tidak merusak perangkat. Dilarang membuat foto yang melanggar hukum, mengandung unsur SARA, pornografi, atau kekerasan. Petugas berhak menghentikan sesi yang melanggar tanpa pengembalian dana.",
    ],
  },
  {
    title: "5. Foto dan data",
    body: [
      "Foto tersimpan di server kami agar bisa diunduh lewat link unik sesi, yang berlaku 7 hari. Data yang dicatat terbatas pada data transaksi (waktu, nominal, metode bayar). Kami tidak menjual data pelanggan.",
    ],
  },
  {
    title: "6. Gangguan layanan",
    body: [
      "Kalau sesi berbayar gagal karena gangguan sistem atau perangkat kami, berlaku Kebijakan Refund. Kami tidak bertanggung jawab atas gangguan dari aplikasi pembayaran atau bank pengguna.",
    ],
  },
  {
    title: "7. Perubahan ketentuan",
    body: [
      "Ketentuan ini dapat diperbarui sewaktu-waktu. Versi terbaru selalu tersedia di halaman ini.",
    ],
  },
];

const REFUND: Block[] = [
  {
    title: "1. Prinsip umum",
    body: [
      "Sesi foto yang sudah dibayar dan sudah berjalan (foto diambil atau dicetak) tidak dapat dikembalikan dananya.",
    ],
  },
  {
    title: "2. Sesi gagal: voucher otomatis",
    body: [
      "Kalau pembayaran sudah terkonfirmasi tetapi sesi tidak berjalan — misalnya pembayaran masuk setelah waktu QRIS habis, booth bermasalah, atau sesi dibatalkan petugas — sistem otomatis menerbitkan voucher senilai pembayaran. Voucher bisa langsung dipakai untuk sesi pengganti di booth.",
    ],
  },
  {
    title: "3. Pengembalian dana",
    body: [
      "Kalau voucher tidak bisa dipakai (misalnya booth tutup permanen) atau terjadi pembayaran ganda, kamu bisa mengajukan pengembalian dana maksimal 7 hari sejak tanggal transaksi.",
      `Kirim email ke ${CONTACT.email} atau WhatsApp ${CONTACT.whatsappLabel} dengan subjek "Refund Mote Capture", sertakan: nama, lokasi booth, waktu transaksi, nominal, dan bukti bayar.`,
    ],
  },
  {
    title: "4. Proses",
    body: [
      "Pengajuan diverifikasi dengan data transaksi di payment gateway. Keputusan diberikan maksimal 14 hari kerja. Dana yang disetujui dikembalikan ke rekening atau e-wallet atas nama pembayar.",
    ],
  },
  {
    title: "5. Pembayaran lewat payment gateway",
    body: [
      "Untuk kendala di sisi payment gateway, kamu juga bisa menghubungi pusat bantuan gateway terkait, misalnya iPaymu di my.ipaymu.com/helpdesk.",
    ],
  },
];

const PAGES = {
  faq: { title: "Pertanyaan yang sering diajukan", blocks: FAQ },
  terms: { title: "Syarat & Ketentuan", blocks: TERMS },
  refund: { title: "Kebijakan Refund", blocks: REFUND },
} as const;

function LegalBody({ page }: { page: keyof typeof PAGES }) {
  const { title, blocks } = PAGES[page];
  return (
    <PublicShell>
      <section className="py-14 sm:py-20">
        <Link to="/" className="text-sm font-semibold text-zinc-500 underline">
          Kembali ke beranda
        </Link>
        <h1 className="mt-6 text-3xl font-bold sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-zinc-500">Terakhir diperbarui: {UPDATED}</p>
        <div className="mt-10 max-w-3xl space-y-9">
          {blocks.map((b) => (
            <div key={b.title}>
              <h2 className="text-xl font-bold">{b.title}</h2>
              {b.body.map((p) => (
                <p key={p.slice(0, 40)} className="mt-2 text-base leading-relaxed text-zinc-600">
                  {p}
                </p>
              ))}
            </div>
          ))}
        </div>
      </section>
    </PublicShell>
  );
}

export function FaqPage() {
  return <LegalBody page="faq" />;
}
export function TermsPage() {
  return <LegalBody page="terms" />;
}
export function RefundPage() {
  return <LegalBody page="refund" />;
}

export function ContactPage() {
  return (
    <PublicShell>
      <section className="py-14 sm:py-20">
        <Link to="/" className="text-sm font-semibold text-zinc-500 underline">
          Kembali ke beranda
        </Link>
        <h1 className="mt-6 text-3xl font-bold sm:text-4xl">Kontak</h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-zinc-600">
          Ada kendala pembayaran, voucher, atau ingin memasang booth di tempatmu? Hubungi kami.
        </p>
        <dl className="mt-10 grid max-w-3xl gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 p-6">
            <dt className="text-sm font-bold uppercase tracking-[0.12em]">WhatsApp</dt>
            <dd className="mt-2">
              <a className="text-lg font-semibold underline" href={CONTACT.whatsappUrl}>
                {CONTACT.whatsappLabel}
              </a>
            </dd>
          </div>
          <div className="rounded-2xl border border-zinc-200 p-6">
            <dt className="text-sm font-bold uppercase tracking-[0.12em]">Email</dt>
            <dd className="mt-2">
              <a className="text-lg font-semibold underline" href={`mailto:${CONTACT.email}`}>
                {CONTACT.email}
              </a>
            </dd>
          </div>
          <div className="rounded-2xl border border-zinc-200 p-6 sm:col-span-2">
            <dt className="text-sm font-bold uppercase tracking-[0.12em]">Alamat</dt>
            <dd className="mt-2 space-y-3 text-base leading-relaxed text-zinc-700">
              <p className="font-semibold">{CONTACT.company}</p>
              {CONTACT.addresses.map((a) => (
                <p key={a}>{a}</p>
              ))}
            </dd>
          </div>
        </dl>
      </section>
    </PublicShell>
  );
}
