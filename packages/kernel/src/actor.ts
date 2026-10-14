/**
 * Who is executing a command. Always explicit — never read from ambient globals inside handlers.
 *
 * - `user`: an authenticated person; `roles` resolved **server-side** from the session/DB by the
 *   edge adapter, never taken from client input (D-005).
 * - `anonymous`: guest cart / checkout; `id` is a server-issued anonymous id; `roles` are ignored
 *   (an anonymous actor can only run `permission: "public"` operations).
 * - `system`: jobs and schedulers. `webhook`: authenticated inbound integrations (PSP, carrier).
 */
export type ActorType = "user" | "system" | "webhook" | "anonymous";

export interface Actor {
  readonly type: ActorType;
  readonly id: string;
  readonly roles: readonly string[];
  /**
   * T-016: a `user`'s account kind, resolved from the database with the roles (`resolveActor` in
   * `@igs/auth`). Absent for system/webhook/anonymous actors.
   */
  readonly kind?: "customer" | "staff";
  /**
   * T-016 Q3: the location the roles were resolved for. `null` (Phase 1) = only all-location grants;
   * multi-location (B-06) sets it without a breaking change.
   */
  readonly locationId?: string | null;
  /**
   * 36b: whether this `user` actor's session proved a second factor that is still enrolled
   * (resolved per request with the roles). A `staff` user without it can run only `public`
   * operations (`kernel.mfa_required`); customers are not affected.
   */
  readonly mfaVerified?: boolean;
  /**
   * igs-pharma#90: when this `user` actor's session last proved a second factor (`null`: never).
   * Handlers that need a FRESH proof (resetting someone's sign-in) compare it with `ctx.now`.
   */
  readonly mfaVerifiedAt?: Date | null;
  /**
   * igs-pharma#100: when this `user` actor's session last passed a PASSKEY check (`null`: never).
   * The FRESH proof for sensitive changes comes from this and only this; `mfaVerifiedAt` (which a
   * TOTP code or a new passkey also set) is the 2-step login gate.
   */
  readonly passkeyCheckedAt?: Date | null;
}
