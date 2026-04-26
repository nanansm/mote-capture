"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  Cog,
  Frame as FrameIcon,
  Home,
  LogOut,
  MapPin,
  MessageSquare,
  PieChart,
  Receipt,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  comingSoon?: boolean;
};

const PRIMARY_NAV: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: Home },
  { label: "Booth", href: "/admin/booths", icon: MapPin },
  { label: "Frame", href: "/admin/frames", icon: FrameIcon },
];

const SECONDARY_NAV: NavItem[] = [
  { label: "Sessions", href: "/admin/sessions", icon: Receipt },
  { label: "Payments", href: "/admin/payments", icon: Receipt },
  { label: "WhatsApp", href: "/admin/whatsapp", icon: MessageSquare },
  { label: "Settings", href: "/admin/settings", icon: Cog },
  { label: "Reports", href: "/admin/reports", icon: PieChart, comingSoon: true },
  { label: "Customers", href: "/admin/customers", icon: Users, comingSoon: true },
];

export function Sidebar({
  email,
  open,
  onClose,
}: {
  email: string;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  function isActive(href: string) {
    if (href === "/admin/dashboard") return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      toast.success("Berhasil keluar");
      router.push("/login");
      router.refresh();
    } catch {
      toast.error("Gagal keluar");
    } finally {
      setLoggingOut(false);
    }
  }

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    const baseClass =
      "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors";
    if (item.comingSoon) {
      return (
        <span
          key={item.href}
          className={cn(baseClass, "cursor-not-allowed text-muted-foreground/70")}
          aria-disabled
        >
          <span className="flex items-center gap-3">
            <Icon className="h-4 w-4" />
            {item.label}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
            Soon
          </span>
        </span>
      );
    }
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        className={cn(
          baseClass,
          active
            ? "bg-brand-yellow text-brand-green-dark"
            : "text-brand-green-dark/80 hover:bg-brand-cream hover:text-brand-green-dark",
        )}
      >
        <span className="flex items-center gap-3">
          <Icon className="h-4 w-4" />
          {item.label}
        </span>
      </Link>
    );
  };

  return (
    <>
      {/* Mobile drawer overlay */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-brand-green-dark/10 bg-white transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:z-30 lg:h-dvh lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-brand-green-dark/10 px-5 py-4">
          <Link href="/admin/dashboard" className="flex items-center gap-2" onClick={onClose}>
            <Image
              src="/wlogogramsquare.webp"
              alt="Mote Kreatif"
              width={32}
              height={32}
              className="rounded-md"
            />
            <span className="text-sm font-semibold leading-tight text-brand-green-dark">
              Capture
              <span className="block text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                by Mote Kreatif
              </span>
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onClose}
            aria-label="Tutup menu"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-1">{PRIMARY_NAV.map(renderItem)}</div>

          <div className="mt-6 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Operasional
          </div>
          <div className="mt-2 space-y-1">{SECONDARY_NAV.map(renderItem)}</div>
        </nav>

        <div className="border-t border-brand-green-dark/10 p-4">
          <div className="mb-3 px-1 text-xs">
            <p className="font-semibold text-brand-green-dark">Account</p>
            <p className="truncate text-muted-foreground" title={email}>
              {email}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <LogOut className="h-4 w-4" />
            Keluar
          </Button>
        </div>
      </aside>
    </>
  );
}
