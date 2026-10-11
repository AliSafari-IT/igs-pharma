import { type ResolvedActor, resolveActor } from "@igs/auth";
import { Alert, Badge, Container, Stack } from "@igs/ui";
import { headers } from "next/headers";

/**
 * Read-only account page (T-016, 36a): who the signed-in person is and the roles **resolved from
 * the database** for this request, the same actor the kernel receives. Nothing here is cached
 * across requests, so a revoked role disappears on the next page load.
 */
export const metadata = { title: "Your account · IGS-Pharma Platform" };

function SignedOut() {
  return (
    <Alert variant="info" title="You are not signed in">
      Sign in to the back-office to see your account and roles.
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
      </dl>

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
  const actor = await resolveActor(await headers());
  return (
    <Container asChild size="md">
      <main className="py-10">
        <Stack gap={6}>
          <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
            Your account
          </h1>
          {actor ? <Account actor={actor} /> : <SignedOut />}
        </Stack>
      </main>
    </Container>
  );
}
