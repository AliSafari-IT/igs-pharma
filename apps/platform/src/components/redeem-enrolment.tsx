"use client";

import { Alert, Button, Stack } from "@igs/ui";
import { useEffect, useState } from "react";

import { authErrorMessage } from "./auth-errors";

/**
 * Redeems a bootstrap enrolment link (36b). The token travels in the URL fragment, so it never
 * reaches a server log; it is read once, removed from the address bar, and only sent when the person
 * presses the button (a link scanner that opens the page does not use up the single-use link).
 */
export function RedeemEnrolment() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (value) setToken(value);
    else setError(authErrorMessage({ code: "ENROLMENT_LINK_INVALID" }));
  }, []);

  async function redeem() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/enrolment/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (response.ok) {
        window.location.replace("/setup");
        return;
      }
      const body = (await response.json().catch(() => null)) as { code?: string } | null;
      setError(authErrorMessage({ code: body?.code ?? "", status: response.status }));
      setToken(null); // the server answered: a link works once, whatever happened
    } catch {
      // no answer (network): the link may still be unused, so keep the button
      setError(authErrorMessage(null));
    }
    setBusy(false);
  }

  return (
    <Stack gap={4}>
      {token ? (
        <Button type="button" onClick={redeem} disabled={busy}>
          Continue
        </Button>
      ) : null}
      {error ? (
        <Alert variant="error" title="This link can't be used">
          {error}
        </Alert>
      ) : null}
    </Stack>
  );
}
