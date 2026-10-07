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
}
