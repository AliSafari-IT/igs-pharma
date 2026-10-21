import { registerEvents } from "@igs/kernel";
import { MailRequested } from "@igs/module-identity";
import { OrderMailRequested, RefundRequested } from "@igs/module-orders";

/**
 * The outbox events this deployment publishes: the ONE list the worker and the migrate entry both
 * register (igs-pharma#66). The migrate entry creates a pg-boss queue per registered topic (queue
 * creation is DDL, which the worker lacks) and the relay only verifies it, so an event registered
 * for the worker but not for migrate would park its outbox rows as dead. Adding an event therefore
 * means: add its definition here, then re-run the migrate entry before starting the new worker.
 * `test/events-parity.test.ts` fails when either entry stops calling this.
 *
 */
export function registerWorkerEvents(): void {
  registerEvents(MailRequested); // identity: account mails (igs-pharma#114)
  registerEvents(RefundRequested); // orders: refunds the worker executes (igs-pharma#156)
  registerEvents(OrderMailRequested); // orders: customer mails about an order (igs-pharma#157)
}
