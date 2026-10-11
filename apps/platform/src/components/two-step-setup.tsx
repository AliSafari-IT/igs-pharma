"use client";

import { authClient } from "@igs/auth/client";
import { Alert, Button, Stack } from "@igs/ui";
import { useId, useState } from "react";

import { authErrorMessage } from "./auth-errors";

interface Props {
  /** Factors already enrolled: then this session only has to confirm with one of them. */
  readonly passkeys: number;
  readonly totp: boolean;
}

type Totp = { readonly key: string; readonly backupCodes: readonly string[] };

const done = () => window.location.assign("/account");

/**
 * "Set up 2-step login" (36b): passkey first, an authenticator app (TOTP) as the backup. With a
 * factor already enrolled the same screen asks to confirm with it instead.
 */
export function TwoStepSetup({ passkeys, totp }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingTotp, setPendingTotp] = useState<Totp | null>(null);
  const [code, setCode] = useState("");
  const codeId = useId();
  const enrolled = passkeys > 0 || totp;

  async function run(action: () => Promise<{ error?: unknown } | undefined | null>) {
    setBusy(true);
    setError(null);
    const result = await action();
    if (result?.error) {
      setError(authErrorMessage(result.error as { code?: string; status?: number }));
      setBusy(false);
      return false;
    }
    setBusy(false);
    return true;
  }

  const addPasskey = async () => {
    if (await run(() => authClient.passkey.addPasskey({ name: "IGS-Pharma back-office" }))) done();
  };
  const confirmWithPasskey = async () => {
    if (await run(() => authClient.signIn.passkey())) done();
  };
  const startTotp = () =>
    run(async () => {
      const result = await authClient.twoFactor.enable({});
      if (result.data?.method === "totp") {
        const uri = result.data.totpURI;
        setPendingTotp({
          key: new URL(uri).searchParams.get("secret") ?? "",
          backupCodes: result.data.backupCodes,
        });
      }
      return result;
    });
  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await run(() => authClient.twoFactor.verifyTotp({ code: code.trim() }))) done();
  };

  const codeForm = (
    <form onSubmit={verifyCode} className="flex flex-col gap-3">
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
  );

  return (
    <Stack gap={6}>
      {error ? (
        <Alert variant="error" title="That didn't work">
          {error}
        </Alert>
      ) : null}

      {enrolled ? (
        <section aria-labelledby="confirm-heading" className="flex flex-col gap-4">
          <h2 id="confirm-heading" className="font-display text-xl font-semibold">
            Confirm it's you
          </h2>
          {passkeys > 0 ? (
            <div>
              <Button type="button" onClick={confirmWithPasskey} disabled={busy}>
                Use your passkey
              </Button>
            </div>
          ) : null}
          {totp ? codeForm : null}
        </section>
      ) : (
        <>
          <section aria-labelledby="passkey-heading" className="flex flex-col gap-3">
            <h2 id="passkey-heading" className="font-display text-xl font-semibold">
              Add a passkey (recommended)
            </h2>
            <p className="text-[var(--color-text-muted)]">
              Your phone, computer or security key signs you in after your PIN, fingerprint or face.
              Nobody can phish it.
            </p>
            <div>
              <Button type="button" onClick={addPasskey} disabled={busy}>
                Add a passkey
              </Button>
            </div>
          </section>

          <section aria-labelledby="totp-heading" className="flex flex-col gap-3">
            <h2 id="totp-heading" className="font-display text-xl font-semibold">
              Or use an authenticator app
            </h2>
            {pendingTotp ? (
              <>
                <p>Add this setup key to your authenticator app, then enter the code it shows.</p>
                <p>
                  Setup key: <code className="break-all">{pendingTotp.key}</code>
                </p>
                {pendingTotp.backupCodes.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="font-medium">
                      Backup codes: keep them somewhere safe. Each works once.
                    </p>
                    <ul className="grid grid-cols-2 gap-1 font-mono">
                      {pendingTotp.backupCodes.map((backup) => (
                        <li key={backup}>{backup}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {codeForm}
              </>
            ) : (
              <div>
                <Button type="button" variant="secondary" onClick={startTotp} disabled={busy}>
                  Set up an authenticator app
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </Stack>
  );
}
