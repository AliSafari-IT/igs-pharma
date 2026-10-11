import { fontDisplay, fontSans } from "@igs/ui/fonts";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../globals.css";

// CSP nonces are per request (src/proxy.ts): render dynamically, like the [locale] layout
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "IGS-Pharma",
  robots: { index: false, follow: false },
};

/**
 * Root layout of the "coming soon" page (igs-pharma#46, IGS-D4). The proxy rewrites every storefront
 * URL here while `SITE_GATE` is on; with the gate off the path is locale-prefixed and never reaches it.
 * The page speaks all four languages at once, each block marked with its own `lang`.
 */
export default function ComingSoonLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl" className={`${fontSans.variable} ${fontDisplay.variable}`}>
      <body className="bg-[var(--color-surface)] text-[var(--color-text)] font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
