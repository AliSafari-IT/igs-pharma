"use client";

import { customerAuthClient } from "@igs/auth/customer-client";
import { Button } from "@igs/ui";
import { useState } from "react";

interface Props {
  readonly locale: string;
  readonly label: string;
}

/** Ends this session, then loads the storefront home so the server renders it signed out. */
export function SignOutButton({ locale, label }: Props) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await customerAuthClient.signOut();
    } finally {
      window.location.assign(`/${locale}`);
    }
  }
  return (
    <Button type="button" variant="ghost" loading={busy} onClick={signOut} data-testid="sign-out">
      {label}
    </Button>
  );
}
