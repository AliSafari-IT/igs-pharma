import { command, defineEvent, notFound } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { IDENTITY_AUDIT } from "./audit";
import { MAIL_TEMPLATES, mailTokens, users } from "./schema";

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
const MAIL_TTL_MS: Record<(typeof MAIL_TEMPLATES)[number], number> = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
  account_exists: 24 * 60 * 60 * 1000,
};

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
    const [row] = await ctx.tx
      .insert(mailTokens)
      .values({
        userId: input.userId,
        template: input.template,
        url: input.url ?? null,
        expiresAt: new Date(ctx.now.getTime() + MAIL_TTL_MS[input.template]),
      })
      .returning({ id: mailTokens.id });
    if (!row) throw new Error("identity.mail_token_not_stored");
    await ctx.audit.record({
      action: IDENTITY_AUDIT.mailRequested,
      entityType: "user",
      entityId: input.userId,
      data: { userId: input.userId, template: input.template },
    });
    await ctx.outbox.publish(MailRequested, {
      userId: input.userId,
      template: input.template,
      tokenRef: row.id,
    });
    return { tokenRef: row.id };
  },
});
