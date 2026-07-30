import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { AdminHeader } from "./header";

const TITLE_MAP: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/dashboard": "Dashboard",
  "/admin/booths": "Booth",
  "/admin/booths/new": "Booth Baru",
  "/admin/frames": "Frame",
  "/admin/frames/new": "Frame Baru",
  "/admin/sessions": "Sessions",
  "/admin/payments": "Payments",
  "/admin/payments/transactions": "Payment Transactions",
  "/admin/whatsapp": "WhatsApp",
  "/admin/reports": "Reports",
  "/admin/customers": "Customers",
  "/admin/settings": "Settings",
};

function deriveTitle(pathname: string): string {
  if (TITLE_MAP[pathname]) return TITLE_MAP[pathname];
  if (pathname.startsWith("/admin/booths/")) return "Edit Booth";
  if (pathname.startsWith("/admin/frames/")) return "Edit Frame";
  if (pathname.startsWith("/admin/sessions/")) return "Detail Session";
  return "Admin";
}

export function AdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const title = deriveTitle(pathname);

  return (
    <div className="min-h-dvh bg-brand-cream/40">
      <div className="lg:flex">
        <Sidebar email={email} open={open} onClose={() => setOpen(false)} />
        <div className="flex min-h-dvh flex-1 flex-col lg:ml-0">
          <AdminHeader title={title} onMenuClick={() => setOpen(true)} />
          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
