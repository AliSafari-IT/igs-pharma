import { isDomainError } from "@igs/kernel";
import { type StaffMember, listStaff } from "@igs/module-identity";
import { Alert, Badge, Container, Stack } from "@igs/ui";

import { identityErrorMessage } from "../../components/identity-labels";
import { ResetSignInDialog } from "../../components/reset-sign-in-dialog";
import { requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

export const metadata = { title: "Staff · IGS-Pharma Platform" };

const signInMethods = (member: StaffMember) =>
  [
    member.passkeys > 0 ? `${member.passkeys} passkey${member.passkeys > 1 ? "s" : ""}` : null,
    member.totp ? "authenticator app" : null,
  ]
    .filter(Boolean)
    .join(", ") || "not set up";

/**
 * The staff accounts (igs-pharma#90), for the owner (`staff.manage`): who has which roles and how
 * they sign in. "Reset sign-in" helps someone who lost their passkey; never for yourself.
 */
export default async function StaffPage() {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  let members: readonly StaffMember[] | null = null;
  let error: string | null = null;
  try {
    members = await listStaff({}, actor);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">Staff</h1>
          <p className="max-w-prose text-[var(--color-text-subtle)]">
            Staff sign in with a passkey. Someone who lost every passkey can't sign in: reset their
            sign-in here and give them the new link.
          </p>
          {error ? (
            <Alert variant="error" title="You can't see the staff list">
              {identityErrorMessage(error)}
            </Alert>
          ) : null}
          {members ? (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--color-border-strong)]">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Name
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Roles
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Signs in with
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-b border-[var(--color-border)] align-top">
                    <td className="py-3 pr-4">
                      <div className="font-medium">{member.name}</div>
                      <div className="text-[var(--color-text-subtle)]">{member.email}</div>
                      {member.status === "suspended" ? (
                        <Badge variant="amber">suspended</Badge>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      {member.roles.length > 0 ? (
                        <ul className="flex flex-wrap gap-1">
                          {member.roles.map((role) => (
                            <li key={role}>
                              <code>{role}</code>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-[var(--color-text-subtle)]">none</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">{signInMethods(member)}</td>
                    <td className="py-3">
                      {member.id !== actor.id && member.status === "active" ? (
                        <ResetSignInDialog userId={member.id} name={member.name} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
