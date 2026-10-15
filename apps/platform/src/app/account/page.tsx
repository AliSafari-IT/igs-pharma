import type { ResolvedActor } from "@igs/auth";
import { Alert, Badge, Container, Link, Stack } from "@igs/ui";
import { redirect } from "next/navigation";

import { AddPasskey } from "../../components/add-passkey";
import { PageHeader } from "../../components/page-header";
import { TotpSetup } from "../../components/totp-setup";
import { currentActor, needsTwoStep, signInPath } from "../../server/actor";

/**
 * Read-only account page (T-016, 36a): who the signed-in person is and the roles **resolved from
 * the database** for this request, the same actor the kernel receives. Nothing here is cached
 * across requests, so a revoked role disappears on the next page load. Staff whose session has not
 * proved a second factor are sent to "Set up 2-step login" (36b).
 */
export const metadata = { title: "Your account · IGS-Pharma Platform" };

function SignedOut() {
  return (
    <Alert variant="info" title="You are not signed in">
      <Link href="/sign-in">Sign in</Link> to the back-office to see your account and roles.
    </Alert>
  );
}

function Account({ actor }: { actor: ResolvedActor }) {
  const { profile } = actor;
  return (
    <Stack gap={6}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-[var(--shadow-card)]">
        <dt className="text-[var(--color-text-subtle)]">Name</dt>
        <dd className="font-medium">{profile.name}</dd>
        <dt className="text-[var(--color-text-subtle)]">E-mail</dt>
        <dd>{profile.email}</dd>
        <dt className="text-[var(--color-text-subtle)]">Account type</dt>
        <dd>
          <Badge variant={actor.kind === "staff" ? "primary" : "neutral"}>{actor.kind}</Badge>
        </dd>
        <dt className="text-[var(--color-text-subtle)]">Status</dt>
        <dd>
          <Badge variant="success">{profile.status}</Badge>
        </dd>
        <dt className="text-[var(--color-text-subtle)]">2-step login</dt>
        <dd>
          {[
            profile.factors.passkeys > 0
              ? `${profile.factors.passkeys} passkey${profile.factors.passkeys > 1 ? "s" : ""}`
              : null,
            profile.factors.totp ? "authenticator app" : null,
          ]
            .filter(Boolean)
            .join(", ") || "not set up"}
        </dd>
      </dl>

      {actor.kind === "staff" ? (
        <section aria-labelledby="two-step-heading" className="flex flex-col gap-4">
          <h2 id="two-step-heading" className="font-display text-xl font-semibold">
            2-step login
          </h2>
          <p className="max-w-prose text-[var(--color-text-subtle)]">
            You sign in with a passkey. Add a second one on another device or a security key, so
            losing one device does not lock you out. If you lose them all, the owner can reset your
            sign-in.
          </p>
          <AddPasskey
            label={profile.factors.passkeys > 0 ? "Add another passkey" : "Add a passkey"}
          />
          {profile.factors.passkeys > 0 && !profile.factors.totp ? (
            <>
              <h3 className="font-semibold">Authenticator app (optional)</h3>
              <p className="max-w-prose text-[var(--color-text-subtle)]">
                A code from an app on your phone can confirm it's you on a device that is already
                signed in. It does not replace your passkey for signing in.
              </p>
              <TotpSetup />
            </>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="roles-heading" className="flex flex-col gap-3">
        <h2 id="roles-heading" className="font-display text-xl font-semibold">
          Roles
        </h2>
        {profile.grants.length === 0 ? (
          <p className="text-[var(--color-text-subtle)]">No roles granted yet.</p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--color-border-strong)]">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Role
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Scope
                </th>
              </tr>
            </thead>
            <tbody>
              {profile.grants.map((grant) => (
                <tr
                  key={`${grant.roleKey}:${grant.locationId ?? "all"}`}
                  className="border-b border-[var(--color-border)]"
                >
                  <td className="py-2 pr-4">
                    <code>{grant.roleKey}</code>
                  </td>
                  <td className="py-2">
                    {grant.locationId === null ? "All locations" : `Location ${grant.locationId}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Stack>
  );
}

export default async function AccountPage() {
  const actor = await currentActor();
  if (actor && needsTwoStep(actor)) redirect("/setup");
  if (!actor) {
    // a staff session that just ran out says why on the sign-in page (#95)
    const path = await signInPath();
    if (path !== "/sign-in") redirect(path);
  }
  return (
    <Container asChild size="md">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader title="Your account" />
          {actor ? <Account actor={actor} /> : <SignedOut />}
        </Stack>
      </main>
    </Container>
  );
}
