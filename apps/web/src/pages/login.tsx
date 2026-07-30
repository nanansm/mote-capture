import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LoginForm } from "@/components/admin/login-form";
import { get } from "@/lib/api";

// Ported from apps/cloud/app/login/page.tsx. The old page was a server
// component that called `getCurrentSession()` before rendering — the SPA
// equivalent is a `GET /api/auth/me` check on mount; a 200 means an
// existing session is still valid, so we skip straight past the form.
export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [checkingSession, setCheckingSession] = useState(true);

  const from = params.get("from");
  const redirectTo = from && from.startsWith("/admin") ? from : "/admin";
  const errorParam = params.get("error");

  useEffect(() => {
    let cancelled = false;
    get("/auth/me")
      .then(() => {
        if (!cancelled) navigate(redirectTo, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
    // Only run once on mount — re-running on `redirectTo` changes would
    // re-fire the /auth/me check every time the `from` query param changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checkingSession) return null;

  return (
    <main className="relative min-h-dvh w-full overflow-hidden bg-brand-cream">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 blob-yellow" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 h-[28rem] w-[28rem] blob-pink" />

      <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px] rounded-2xl border border-brand-green-dark/10 bg-white p-8 shadow-xl">
          <div className="mb-6 flex flex-col items-center text-center">
            <img
              src="/wlogogramsquare.webp"
              alt="Mote Kreatif"
              width={80}
              height={80}
              className="rounded-2xl"
            />
            <h1 className="mt-4 text-xl font-semibold text-brand-green-dark">
              Capture by Mote Kreatif
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Admin Panel</p>
          </div>

          <LoginForm
            redirectTo={redirectTo}
            initialError={errorParam === "config" ? "Konfigurasi server tidak valid." : undefined}
          />
        </div>
      </div>
    </main>
  );
}
