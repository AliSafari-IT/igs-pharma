import { isDomainError } from "@igs/kernel";
import { type StaffMember, listStaff } from "@igs/module-identity";
import { PHARMACIST_ROLES, ROLES, ROLE_KEYS } from "@igs/rbac";
import { Alert, Badge, Container, Stack } from "@igs/ui";

import { identityErrorMessage } from "../../components/identity-labels";
import { PageHeader } from "../../components/page-header";
import { ResetSignInDialog } from "../../components/reset-sign-in-dialog";
import { StaffAccessDialog } from "../../components/staff-access-dialog";
import { staffRoleLabel } from "../../lib/role-labels";
import { requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

export const metadata = { title: "Staff · IGS-Pharma Platform" };

/** The roles a staff account can hold (customer and system roles are not for people on this page). */
const STAFF_ROLES = ROLE_KEYS.filter((role) => ROLES[role].kind === "staff");

/** A role key with the name staff read; the key stays what the Access form sends. */
const roleOption = (key: string) => ({ key, label: staffRoleLabel(key) });

/** A member's roles in catalogue order; keys the catalogue doesn't know come last, as they are. */
const inCatalogueOrder = (roles: readonly string[]) => {
  const known = ROLE_KEYS.filter((role) => roles.includes(role));
  const unknown = new Set(roles.filter((role) => !(ROLE_KEYS as readonly string[]).includes(role)));
  return [...known, ...unknown];
};

/** The staff roles a member doesn't hold yet, in catalogue order: what the owner may grant. */
const grantableTo = (roles: readonly string[]) =>
  STAFF_ROLES.filter((role) => !roles.includes(role)).map(roleOption);

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
          <PageHeader
            title="Staff"
            description="Staff sign in with a passkey. Someone who lost every passkey can't sign in: reset their sign-in here and give them the new link."
          />
          {error ? (
            <Alert variant="error" title="You can't see the staff list">
              {identityErrorMessage(error)}
            </Alert>
          ) : null}
          {members ? (
            <div className="overflow-x-auto">
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
                            {inCatalogueOrder(member.roles).map((role) => (
                              <li key={role}>
                                <Badge variant="neutral" data-testid="staff-role-badge">
                                  {staffRoleLabel(role)}
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-[var(--color-text-subtle)]">none</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">{signInMethods(member)}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          {member.id !== actor.id ? (
                            <StaffAccessDialog
                              userId={member.id}
                              name={member.name}
                              status={member.status}
                              roles={inCatalogueOrder(member.roles).map(roleOption)}
                              grantable={grantableTo(member.roles)}
                              pharmacist={member.roles.some((role) =>
                                (PHARMACIST_ROLES as readonly string[]).includes(role),
                              )}
                            />
                          ) : null}
                          {member.id !== actor.id && member.status === "active" ? (
                            <ResetSignInDialog userId={member.id} name={member.name} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
