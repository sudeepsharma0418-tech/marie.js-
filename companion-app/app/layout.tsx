import type { Metadata, Viewport } from "next";
import { Inter, DM_Serif_Display } from "next/font/google";
import { APP_NAME, TAGLINE } from "@/lib/config";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = DM_Serif_Display({ subsets: ["latin"], weight: "400", variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: `${APP_NAME}: AI companions that remember you`, template: `%s · ${APP_NAME}` },
  description: TAGLINE,
  openGraph: { title: APP_NAME, description: TAGLINE, type: "website" },
};

export const viewport: Viewport = { themeColor: "#11121a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
