import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { APP_NAME, TAGLINE } from "@/lib/config";
import "./globals.css";

const sans = Manrope({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: `${APP_NAME}: AI companions that remember you`, template: `%s · ${APP_NAME}` },
  description: TAGLINE,
  openGraph: { title: APP_NAME, description: TAGLINE, type: "website" },
};

export const viewport: Viewport = { themeColor: "#d0bcac" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
