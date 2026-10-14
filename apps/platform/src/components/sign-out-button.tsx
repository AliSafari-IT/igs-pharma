"use client";

import { authClient } from "@igs/auth/client";
import { Button } from "@igs/ui";
import { useState } from "react";

/** Ends this session on the server, then goes to the sign-in page. */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    // the page follows even if the call fails: the next request resolves the session again
    await authClient.signOut().catch(() => undefined);
    window.location.assign("/sign-in");
  };
  return (
    <Button type="button" variant="secondary" loading={busy} onClick={signOut}>
      Sign out
    </Button>
  );
}
