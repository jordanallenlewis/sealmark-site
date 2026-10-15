import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ScrollToTop } from "@/components/ScrollToTop";
import { AUTHOR, SITE } from "@/lib/site";
import { METHODOLOGY } from "@/lib/data";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700", "800"] });
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  metadataBase: new URL(`https://${SITE.host}`),
  title: "Sealmark: behavioral conformance tests for MCP servers",
  description: `Behavioral conformance tests for MCP servers. Fixed probes, no model in the loop, one A–F grade per test suite with the evidence behind it. Methodology ${METHODOLOGY}.`,
  authors: [{ name: AUTHOR.name, url: AUTHOR.url }],
  creator: AUTHOR.name,
  openGraph: { type: "website", siteName: "Sealmark", locale: "en_US" },
  twitter: { card: "summary_large_image" },
  robots: { index: false, follow: false }, // not promoting yet: keep out of search until the owner says otherwise
};

export const viewport: Viewport = { themeColor: "#111214", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body><ScrollToTop />{children}</body>
    </html>
  );
}
