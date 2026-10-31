import { type Ctx, command, defineEvent, notFound } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { IDENTITY_AUDIT } from "./audit";
import { MAIL_TEMPLATES, type MailTemplate, mailTokens, users } from "./schema";

/**
 * A mail the identity flows want sent (igs-pharma#114, D-044, D-019: no e-mail from a request).
 * Identifiers only (D-020): the user, the template, and `tokenRef`, the id of the `mail_tokens` row
 * that holds the link. The link (a verification or reset token) is in no payload; the worker reads
 * the row, sends the mail and deletes it.
 */
export const MailRequested = defineEvent(
  "identity.mail.requested",
  1,
  z.object({
    userId: z.uuid(),
    template: z.enum(MAIL_TEMPLATES),
    tokenRef: z.uuid(),
  }),
);

/** How long a mail may wait for the worker before it is dropped unsent. */
const DAY_MS = 24 * 60 * 60 * 1000;
const MAIL_TTL_MS: Record<MailTemplate, number> = {
  verify_email: DAY_MS,
  reset_password: 60 * 60 * 1000,
  account_exists: DAY_MS,
  early_access_received: DAY_MS,
  early_access_approved: DAY_MS,
  early_access_rejected: DAY_MS,
  early_access_revoked: DAY_MS,
  early_access_staff_notice: DAY_MS,
};

/**
 * Stores one mail for the worker and publishes {@link MailRequested}, inside the caller's transaction
 * (the outbox): `requestMail` and the early-access commands (igs-pharma#199) share it. The caller has
 * checked that the user exists.
 */
export async function queueMail(
  ctx: Ctx,
  mail: {
    readonly userId: string;
    readonly template: MailTemplate;
    readonly url?: string | undefined;
    readonly validUntil?: Date | null | undefined;
  },
): Promise<string> {
  const [row] = await ctx.tx
    .insert(mailTokens)
    .values({
      userId: mail.userId,
      template: mail.template,
      url: mail.url ?? null,
      validUntil: mail.validUntil ?? null,
      expiresAt: new Date(ctx.now.getTime() + MAIL_TTL_MS[mail.template]),
    })
    .returning({ id: mailTokens.id });
  if (!row) throw new Error("identity.mail_token_not_stored");
  await ctx.audit.record({
    action: IDENTITY_AUDIT.mailRequested,
    entityType: "user",
    entityId: mail.userId,
    data: { userId: mail.userId, template: mail.template },
  });
  await ctx.outbox.publish(MailRequested, {
    userId: mail.userId,
    template: mail.template,
    tokenRef: row.id,
  });
  return row.id;
}

/**
 * Better Auth's mail callbacks call this and nothing else: it stores the link and publishes
 * {@link MailRequested} in ONE transaction (the outbox), so a mail is requested exactly when the
 * request that needed it commits. Run by the app's composition root as a `system_auth` actor, so
 * `@igs/auth` never depends on the kernel (the same inversion as `onSecurityEvent`).
 */
export const requestMail = command({
  name: "identity.mail.request",
  input: z.object({
    userId: z.uuid(),
    template: z.enum(MAIL_TEMPLATES),
    /** The link to send; absent for templates without one (`account_exists`). */
    url: z.string().url().max(2048).optional(),
  }),
  permission: PERMISSIONS.identity.mailRequest,
  async handler({ input, ctx }) {
    const [user] = await ctx.tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId));
    if (!user) throw notFound("identity.user_not_found");
    const tokenRef = await queueMail(ctx, input);
    return { tokenRef };
  },
});
