import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AdminShell } from "@/components/admin/admin-shell";
import { get } from "@/lib/api";

// Ported from apps/cloud/app/admin/layout.tsx's `getCurrentSession()` guard.
// The SPA equivalent calls `GET /api/auth/me` once on mount: a 401 sends the
// visitor to /login (preserving the current path in `?from=` so LoginForm
// can send them back after a successful login); a 200 supplies the real
// admin email for the header/sidebar instead of the old hardcoded stand-in.
export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<{ email: string }>("/auth/me")
      .then((data) => {
        if (!cancelled) setEmail(data.email);
      })
      .catch(() => {
        if (cancelled) return;
        const from = encodeURIComponent(location.pathname + location.search);
        navigate(`/login?from=${from}`, { replace: true });
      });
    return () => {
      cancelled = true;
    };
    // Intentionally only on mount — this is the "sekali saat mount" auth
    // check the task calls for, not a per-navigation re-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing to render yet (auth check in flight or about to redirect).
  if (!email) return null;

  return (
    <AdminShell email={email}>
      <Outlet />
    </AdminShell>
  );
}
