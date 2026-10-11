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
}
