"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Stack } from "@igs/ui";
import { useId, useState } from "react";

import { authErrorMessage, withFreshPasskey } from "./auth-errors";

type Pending = { readonly key: string; readonly backupCodes: readonly string[] };

/**
 * Add an authenticator app (TOTP) as an EXTRA way to confirm it's you (igs-pharma#90): staff sign in
 * with a passkey only, so this is offered on the account page once a passkey exists, never as the
 * first factor.
 */
export function TotpSetup() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState("");
  const codeId = useId();

  async function run(action: () => Promise<{ error?: unknown } | undefined | null>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result?.error) {
        setError(authErrorMessage(result.error as { code?: string; status?: number }));
        return false;
      }
      return true;
    } catch {
      setError(authErrorMessage(null));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => {
      const result = await withFreshPasskey(
        () => authClient.twoFactor.enable({}),
        () => authClient.signIn.passkey(),
      );
      if (result.data?.method === "totp") {
        setPending({
          key: new URL(result.data.totpURI).searchParams.get("secret") ?? "",
          backupCodes: result.data.backupCodes,
        });
      }
      return result;
    });
  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      await run(() =>
        withFreshPasskey(
          () => authClient.twoFactor.verifyTotp({ code: code.trim() }),
          () => authClient.signIn.passkey(),
        ),
      )
    ) {
      window.location.assign("/account");
    }
  };

  return (
    <Stack gap={4}>
      {error ? (
        <Alert variant="error" title="That didn't work">
          {error}
        </Alert>
      ) : null}
      {pending ? (
        <>
          <p>Add this setup key to your authenticator app, then enter the code it shows.</p>
          <p>
            Setup key: <code className="break-all">{pending.key}</code>
          </p>
          {pending.backupCodes.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="font-medium">
                Backup codes: keep them somewhere safe. Each works once.
              </p>
              <ul className="grid grid-cols-2 gap-1 font-mono">
                {pending.backupCodes.map((backup) => (
                  <li key={backup}>{backup}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <form onSubmit={verify} className="flex flex-col gap-3">
            <label htmlFor={codeId} className="font-medium">
              6-digit code from your authenticator app
            </label>
            <input
              id={codeId}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="w-40 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2 text-lg tracking-widest"
            />
            <div>
              <Button type="submit" variant="secondary" disabled={busy}>
                Confirm code
              </Button>
            </div>
          </form>
        </>
      ) : (
        <div>
          <Button type="button" variant="secondary" onClick={start} disabled={busy}>
            Set up an authenticator app
          </Button>
        </div>
      )}
    </Stack>
  );
}
