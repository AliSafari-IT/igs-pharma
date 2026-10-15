import { fontDisplay, fontSans } from "@igs/ui/fonts";
import type { ReactNode } from "react";

import { BackOfficeShell } from "../components/back-office-shell";
import { IdleGuard } from "../components/idle-guard";
import { visibleNav } from "../lib/nav";
import { staffRoleSummary } from "../lib/role-labels";
import { currentActor, needsTwoStep } from "../server/actor";
import { ensureKernelConfigured } from "../server/kernel";

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
  // the back-office frame (#115) for a staff member who has finished 2-step setup; the sign-in,
  // setup and enrolment pages stay bare
  let framed: ReactNode = children;
  if (actor?.kind === "staff" && !needsTwoStep(actor)) {
    await ensureKernelConfigured(); // loads the RBAC catalogue the menu is filtered by
    framed = (
      <BackOfficeShell
        name={actor.profile.name}
        roleSummary={staffRoleSummary(actor.roles)}
        groups={visibleNav(actor.roles)}
      >
        {children}
      </BackOfficeShell>
    );
  }
  return (
    <html lang="en" className={`${fontSans.variable} ${fontDisplay.variable}`}>
      <body className="bg-[var(--color-surface)] text-[var(--color-text)] font-sans antialiased">
        {actor?.kind === "staff" ? <IdleGuard>{framed}</IdleGuard> : children}
      </body>
    </html>
  );
}
