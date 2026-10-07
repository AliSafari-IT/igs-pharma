import type { ReactNode } from "react";

import "@igs/ui/styles/tokens.css";
import "@igs/ui/styles/global.css";

// CSP nonces are per request (src/proxy.ts, T-011): prerendered HTML would carry no nonce and its
// scripts would be blocked, so every page renders dynamically (accepted trade-off, D-031/D-008).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "IGS-Pharma Platform",
  description: "Pharmacy back-office and management platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[var(--color-surface)] text-[var(--color-text)] font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
