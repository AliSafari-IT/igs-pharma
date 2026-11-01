"use server";

import { authEnv } from "@igs/config/env";
import { getKernelRuntime, isDomainError } from "@igs/kernel";
import {
  EARLY_ACCESS_DURATIONS,
  USER_LOCALES,
  approveEarlyAccess,
  cancelEarlyAccessInvitation,
  consumeRateLimit,
  inviteEarlyAccess,
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

const INTENTS = ["approve", "reject", "revoke", "cancel"] as const;
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
    } else if (intent === "cancel") {
      // igs-pharma#211: an invitation nobody redeemed
      await cancelEarlyAccessInvitation({ requestId }, actor, options);
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

/** igs-pharma#211: at most this many invitations per owner and hour, so the form sends no bulk mail. */
const INVITE_LIMIT = { windowSeconds: 60 * 60, max: 20 } as const;

/**
 * Invites an e-mail address (igs-pharma#211), with the same passkey retry as the decisions. The answer
 * is the same whether or not the address has an account (`done`): the page lists an invitation, or a
 * grant when a verified customer had that address already.
 */
export async function inviteToEarlyAccess(
  _previous: EarlyAccessDecisionState,
  form: FormData,
): Promise<EarlyAccessDecisionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const duration = text(form, "duration");
  const locale = text(form, "locale");
  if (
    !(EARLY_ACCESS_DURATIONS as readonly string[]).includes(duration) ||
    !(USER_LOCALES as readonly string[]).includes(locale)
  ) {
    return { error: "kernel.invalid_input" };
  }
  const allowed = await consumeRateLimit(
    getKernelRuntime().db,
    `igs:early-access:invite:user:${actor.id}`,
    INVITE_LIMIT,
    new Date(),
  );
  if (!allowed) return { error: "identity.early_access.rate_limited" };
  const link = storefrontLink();
  try {
    await inviteEarlyAccess(
      {
        email: text(form, "email"),
        duration: duration as (typeof EARLY_ACCESS_DURATIONS)[number],
        locale: locale as (typeof USER_LOCALES)[number],
        ...(link ? { link } : {}),
      },
      actor,
      { origin: await requestOrigin(), idempotencyKey: text(form, "submissionId") },
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  revalidatePath("/early-access");
  return { done: true };
}
