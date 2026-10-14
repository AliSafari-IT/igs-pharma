"use server";

import { authEnv, parseEnvFor } from "@igs/config/env";
import { isDomainError } from "@igs/kernel";
import { resetStaffSignIn } from "@igs/module-identity";
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
  let result: { token: string; expiresAt: Date };
  try {
    result = await resetStaffSignIn({ userId: typeof userId === "string" ? userId : "" }, actor, {
      origin: await requestOrigin(),
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  revalidatePath("/staff");
  return { link: enrolmentLink(result.token), expiresAt: result.expiresAt.toISOString() };
}
