"use server";

import { authEnv, parseEnvFor } from "@igs/config/env";
import { isDomainError } from "@igs/kernel";
import {
  deletePharmacist,
  deleteUser,
  grantPharmacistRole,
  grantRole,
  reactivatePharmacist,
  reactivateUser,
  resetStaffSignIn,
  revokePharmacistRole,
  revokeRole,
  suspendPharmacist,
  suspendUser,
} from "@igs/module-identity";
import { PHARMACIST_ROLES, ROLE_KEYS, type RoleKey } from "@igs/rbac";
import { revalidatePath } from "next/cache";

import { requestOrigin, requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

/** The Reset sign-in dialog. `link` is shown ONCE, to the owner who asked for it. */
export interface ResetSignInState {
  readonly error?: string;
  readonly link?: string;
  readonly expiresAt?: string;
}

/** The enrolment link, the same shape the bootstrap CLI prints (token in the fragment, never logged). */
function enrolmentLink(token: string): string {
  const url = new URL("/enrol", parseEnvFor(authEnv).AUTH_URL);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

const SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reset another staff member's sign-in (igs-pharma#90): deletes their passkeys and authenticator
 * apps, signs them out everywhere, and returns a new 15-minute enrolment link for the owner to hand
 * over through a channel they trust.
 */
export async function resetSignIn(
  _previous: ResetSignInState,
  form: FormData,
): Promise<ResetSignInState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const userId = form.get("userId");
  // #110: the form's submission id is the idempotency key, so a double click or the resubmit after
  // the passkey check mints ONE enrolment link (the second call replays the first answer)
  const submissionId = form.get("submissionId");
  const idempotencyKey =
    typeof submissionId === "string" && SUBMISSION_ID.test(submissionId)
      ? { idempotencyKey: `reset:${submissionId.toLowerCase()}` }
      : {};
  let result: { token: string; expiresAt: Date };
  try {
    result = await resetStaffSignIn({ userId: typeof userId === "string" ? userId : "" }, actor, {
      origin: await requestOrigin(),
      ...idempotencyKey,
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  revalidatePath("/staff");
  return { link: enrolmentLink(result.token), expiresAt: result.expiresAt.toISOString() };
}

/** The Staff "Access" dialog (igs-pharma#95). */
export interface ChangeAccessState {
  readonly error?: string;
  readonly done?: boolean;
}

const INTENTS = ["grant", "revoke", "suspend", "reactivate", "delete"] as const;
type Intent = (typeof INTENTS)[number];

/**
 * A role grant or revoke, or a suspend, reactivate or delete (igs-pharma#95). Every one needs the
 * acting person's passkey check from the last 10 minutes (`identity.fresh_mfa_required`; the dialog
 * asks for the passkey and submits the SAME form again). The form's `submissionId` is the kernel's
 * idempotency key, so a retry or a double submit applies the change once. Which command family
 * runs follows the target (D-035): a pharmacist role, or an account that holds one, goes through the
 * pharmacist commands; the kernel's permission check still decides who may.
 */
export async function changeAccess(
  _previous: ChangeAccessState,
  form: FormData,
): Promise<ChangeAccessState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const intent = field("intent") as Intent;
  const userId = field("userId");
  const roleKey = field("roleKey") as RoleKey;
  const submissionId = field("submissionId");
  if (!INTENTS.includes(intent)) return { error: "kernel.invalid_input" };
  const options = { origin: await requestOrigin(), idempotencyKey: submissionId };
  const holdsPharmacistRole = field("pharmacist") === "1";
  try {
    if (intent === "grant" || intent === "revoke") {
      if (!ROLE_KEYS.includes(roleKey)) return { error: "kernel.invalid_input" };
      const run = PHARMACIST_ROLES.includes(roleKey)
        ? intent === "grant"
          ? grantPharmacistRole
          : revokePharmacistRole
        : intent === "grant"
          ? grantRole
          : revokeRole;
      await run({ userId, roleKey }, actor, options);
    } else {
      const run = holdsPharmacistRole
        ? { suspend: suspendPharmacist, reactivate: reactivatePharmacist, delete: deletePharmacist }
        : { suspend: suspendUser, reactivate: reactivateUser, delete: deleteUser };
      await run[intent]({ userId }, actor, options);
    }
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  revalidatePath("/staff");
  return { done: true };
}
