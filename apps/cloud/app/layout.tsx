import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Capture by Mote Kreatif",
  description: "Admin panel photobooth Mote Capture",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className={jakarta.variable}>
      <body className="font-sans antialiased">
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
