import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Capture · Maja Photobooth",
  description: "Photobooth kiosk",
};

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-hidden bg-brand-cream text-brand-green-dark">
      {children}
    </div>
  );
}
