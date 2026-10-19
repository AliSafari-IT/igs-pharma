import { command, notFound, query } from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { IDENTITY_AUDIT } from "./audit";
import { USER_LOCALES, type UserLocale, users } from "./schema";

/**
 * A customer's own account (igs-pharma#114, D-044). Every command here acts on `ctx.actor.id` and has
 * no user id in its input, so one customer can never reach another's row. A suspended or deleted
 * account is "not found": its session is already refused, this is the second line.
 */

export interface OwnAccount {
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly locale: UserLocale;
}

export const getOwnAccount = query({
  name: "identity.self.account.get",
  input: z.object({}),
  permission: PERMISSIONS.account.selfRead,
  async handler({ ctx }): Promise<OwnAccount> {
    const [row] = await ctx.tx
      .select({
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        locale: users.locale,
      })
      .from(users)
      .where(and(eq(users.id, ctx.actor.id), eq(users.status, "active")));
    if (!row) throw notFound("identity.user_not_found");
    return row;
  },
});

/** Name and language: the whole profile until checkout adds addresses and a phone number (Sprint 3). */
export const updateOwnProfile = command({
  name: "identity.self.profile.update",
  input: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      locale: z.enum(USER_LOCALES).optional(),
    })
    .refine((value) => value.name !== undefined || value.locale !== undefined, {
      message: "identity.profile_empty",
    }),
  permission: PERMISSIONS.account.selfUpdate,
  async handler({ input, ctx }) {
    const [updated] = await ctx.tx
      .update(users)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.locale === undefined ? {} : { locale: input.locale }),
        updatedAt: ctx.now,
      })
      .where(and(eq(users.id, ctx.actor.id), eq(users.status, "active")))
      .returning({ id: users.id });
    if (!updated) throw notFound("identity.user_not_found");
    await ctx.audit.record({
      action: IDENTITY_AUDIT.profileUpdated,
      entityType: "user",
      entityId: ctx.actor.id,
      // which fields changed, never the new values: a name is personal data (D-028)
      data: {
        userId: ctx.actor.id,
        nameChanged: input.name !== undefined,
        localeChanged: input.locale !== undefined,
      },
    });
  },
});
