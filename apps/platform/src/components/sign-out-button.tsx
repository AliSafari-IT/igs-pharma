"use client";

import { authClient } from "@igs/auth/client";
import { useState } from "react";

/**
 * Ends this session on the server, then goes to the sign-in page. Drawn for the charcoal top bar
 * (igs-pharma#197): light text and border, the raised hover; the global focus ring is the top bar's.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    // the page follows even if the call fails: the next request resolves the session again
    await authClient.signOut().catch(() => undefined);
    window.location.assign("/sign-in");
  };
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-busy={busy || undefined}
      className="inline-flex min-h-[44px] items-center rounded-[var(--radius-md)] border border-[var(--color-on-topbar-muted)] px-4 font-semibold text-[var(--color-on-topbar)] hover:bg-[var(--color-topbar-raised)] disabled:opacity-70"
    >
      Sign out
    </button>
  );
}
