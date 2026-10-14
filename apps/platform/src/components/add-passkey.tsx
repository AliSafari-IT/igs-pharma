"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Stack } from "@igs/ui";
import { useState } from "react";

import { authErrorMessage, withFreshPasskey } from "./auth-errors";

/**
 * Add a passkey from the account page (igs-pharma#90): a second one (another device or a security
 * key) is the best backup, since staff sign in with a passkey only.
 */
export function AddPasskey({ label }: { readonly label: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const result = await withFreshPasskey(
        () => authClient.passkey.addPasskey({ name: "IGS-Pharma back-office" }),
        () => authClient.signIn.passkey(),
      );
      if (!result?.error) {
        window.location.assign("/account");
        return;
      }
      setError(authErrorMessage(result.error as { code?: string; status?: number }));
    } catch {
      setError(authErrorMessage(null));
    }
    setBusy(false);
  }

  return (
    <Stack gap={3}>
      <div>
        <Button type="button" variant="secondary" onClick={add} disabled={busy}>
          {label}
        </Button>
      </div>
      {error ? (
        <Alert variant="error" title="That didn't work">
          {error}
        </Alert>
      ) : null}
    </Stack>
  );
}
