import { registerEvents } from "@igs/kernel";

/**
 * The outbox events this deployment publishes: the ONE list the worker and the migrate entry both
 * register (igs-pharma#66). The migrate entry creates a pg-boss queue per registered topic (queue
 * creation is DDL, which the worker lacks) and the relay only verifies it, so an event registered
 * for the worker but not for migrate would park its outbox rows as dead. Adding an event therefore
 * means: add its definition here, then re-run the migrate entry before starting the new worker.
 * `test/events-parity.test.ts` fails when either entry stops calling this.
 *
 * (No module publishes an event yet.)
 */
export function registerWorkerEvents(): void {
  registerEvents();
}
