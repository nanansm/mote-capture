"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AdminHeader({
  title,
  onMenuClick,
}: {
  title: string;
  onMenuClick: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-brand-green-dark/10 bg-white/95 px-4 backdrop-blur lg:h-16 lg:px-8">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMenuClick}
        aria-label="Buka menu"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <h1 className="truncate text-base font-semibold text-brand-green-dark lg:text-lg">
        {title}
      </h1>
    </header>
  );
}
