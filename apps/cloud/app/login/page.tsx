import { redirect } from "next/navigation";
import Image from "next/image";
import { getCurrentSession } from "@/lib/auth";
import { LoginForm } from "@/components/admin/login-form";

export const metadata = {
  title: "Masuk · Capture by Mote Kreatif",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const session = await getCurrentSession();
  const params = await searchParams;
  if (session) {
    redirect(params.from && params.from.startsWith("/admin") ? params.from : "/admin");
  }

  return (
    <main className="relative min-h-dvh w-full overflow-hidden bg-brand-cream">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 blob-yellow" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 h-[28rem] w-[28rem] blob-pink" />

      <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px] rounded-2xl border border-brand-green-dark/10 bg-white p-8 shadow-xl">
          <div className="mb-6 flex flex-col items-center text-center">
            <Image
              src="/wlogogramsquare.webp"
              alt="Mote Kreatif"
              width={80}
              height={80}
              priority
              className="rounded-2xl"
            />
            <h1 className="mt-4 text-xl font-semibold text-brand-green-dark">
              Capture by Mote Kreatif
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Admin Panel</p>
          </div>

          <LoginForm
            redirectTo={params.from && params.from.startsWith("/admin") ? params.from : "/admin"}
            initialError={params.error === "config" ? "Konfigurasi server tidak valid." : undefined}
          />
        </div>
      </div>
    </main>
  );
}
