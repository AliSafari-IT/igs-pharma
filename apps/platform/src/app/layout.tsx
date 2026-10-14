import { fontDisplay, fontSans } from "@igs/ui/fonts";
import type { ReactNode } from "react";

import { IdleGuard } from "../components/idle-guard";
import { currentActor } from "../server/actor";

// Tailwind + @igs/ui tokens + global base styles (one entry, T-015)
import "./globals.css";

// CSP nonces are per request (src/proxy.ts, T-011): prerendered HTML would carry no nonce and its
// scripts would be blocked, so every page renders dynamically (accepted trade-off, D-031/D-008).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "IGS-Pharma Platform",
  description: "Pharmacy back-office and management platform",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // #95: a signed-in staff tab clears itself after 30 minutes without input; the server refuses
  // the next request either way
  const actor = await currentActor();
  return (
    <html lang="en" className={`${fontSans.variable} ${fontDisplay.variable}`}>
      <body className="bg-[var(--color-surface)] text-[var(--color-text)] font-sans antialiased">
        {actor?.kind === "staff" ? <IdleGuard>{children}</IdleGuard> : children}
      </body>
    </html>
  );
}
