import { fontDisplay, fontSans } from "@igs/ui/fonts";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../globals.css";

// CSP nonces are per request (src/proxy.ts): render dynamically, like the [locale] layout
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Preview · IGS-Pharma",
  robots: { index: false, follow: false },
};

/**
 * Root layout of the preview key form (igs-pharma#91). The proxy rewrites `GET /preview` here only
 * while the gate is on and a preview key is configured. For the owner and testers, so English only.
 */
export default function PreviewKeyLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fontSans.variable} ${fontDisplay.variable}`}>
      <body className="bg-[var(--color-surface)] text-[var(--color-text)] font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
