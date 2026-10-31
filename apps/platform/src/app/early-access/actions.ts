"use server";

import { authEnv } from "@igs/config/env";
import { isDomainError } from "@igs/kernel";
import {
  EARLY_ACCESS_DURATIONS,
  approveEarlyAccess,
  rejectEarlyAccess,
  revokeEarlyAccess,
} from "@igs/module-identity";
import { revalidatePath } from "next/cache";

import { requestOrigin, requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

/** The early-access dialogs (igs-pharma#199). */
export interface EarlyAccessDecisionState {
  readonly error?: string;
  readonly done?: boolean;
}

const INTENTS = ["approve", "reject", "revoke"] as const;
type Intent = (typeof INTENTS)[number];

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * Where the approval mail sends the person: the storefront's early-access page, when the storefront's
 * public address is configured (`STOREFRONT_URL`); otherwise the mail goes without a link.
 */
function storefrontLink(): string | undefined {
  const parsed = authEnv.shape.STOREFRONT_URL.safeParse(process.env["STOREFRONT_URL"]);
  if (!parsed.success || !parsed.data) return undefined;
  return new URL("/early-access", parsed.data).toString();
}

/**
 * Approve (with a duration), reject or revoke one early-access request (igs-pharma#199). Each needs the
 * owner's passkey check from the last 10 minutes (`identity.fresh_mfa_required`: the dialog asks for
 * the passkey and submits the SAME form again). The form's `submissionId` is the kernel's idempotency
 * key, so a retry or a double submit decides once. The commands refuse anyone without
 * `storefront.early_access.manage` and a decision on the actor's own request.
 */
export async function decideEarlyAccess(
  _previous: EarlyAccessDecisionState,
  form: FormData,
): Promise<EarlyAccessDecisionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const intent = text(form, "intent") as Intent;
  if (!(INTENTS as readonly string[]).includes(intent)) return { error: "kernel.invalid_input" };
  const requestId = text(form, "requestId");
  const reason = text(form, "reason");
  const options = {
    origin: await requestOrigin(),
    idempotencyKey: text(form, "submissionId"),
  };
  try {
    if (intent === "approve") {
      const duration = text(form, "duration");
      if (!(EARLY_ACCESS_DURATIONS as readonly string[]).includes(duration)) {
        return { error: "kernel.invalid_input" };
      }
      const link = storefrontLink();
      await approveEarlyAccess({ requestId, duration, ...(link ? { link } : {}) }, actor, options);
    } else if (intent === "reject") {
      await rejectEarlyAccess({ requestId, reason }, actor, options);
    } else {
      await revokeEarlyAccess({ requestId, reason }, actor, options);
    }
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  revalidatePath("/early-access");
  return { done: true };
}
