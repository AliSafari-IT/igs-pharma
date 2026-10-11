"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Stack } from "@igs/ui";
import { useState } from "react";

import { authErrorMessage } from "./auth-errors";

/** "Sign in with a passkey" (36b). Staff have no password; a passkey with user verification is 2-step. */
export function PasskeySignIn() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setError(authErrorMessage(result.error));
      setBusy(false);
      return;
    }
    window.location.assign("/account");
  }

  return (
    <Stack gap={4}>
      <Button type="button" onClick={signIn} disabled={busy}>
        Sign in with a passkey
      </Button>
      {error ? (
        <Alert variant="error" title="Sign-in failed">
          {error}
        </Alert>
      ) : null}
    </Stack>
  );
}
