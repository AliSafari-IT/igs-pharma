import type { AuditPort } from "@igs/kernel";

import { parseAuditData } from "./actions";
import { type RecordOptions, record } from "./record";

/**
 * The kernel's `AuditPort` backed by the hash chain. Apps wire it in their composition root:
 *
 *     configureKernel({ audit: createAuditPort({ hmacKey: env.AUDIT_HMAC_KEY }) })   // web / platform
 *     configureKernel({ audit: createAuditPort() })                                    // worker: no origin, no key
 *
 * Entries are written right before commit inside the command's transaction, so they commit or
 * roll back with it. `validate` runs when a handler calls `ctx.audit.record`, so an unregistered
 * action or invalid `data` fails in the handler's stack. An entry with an `origin` and no key
 * throws `audit.origin_without_key` (fail closed).
 */
export function createAuditPort(options: RecordOptions = {}): AuditPort {
  return {
    validate(entry) {
      parseAuditData(entry.action, entry.data);
    },
    async record(entry, { actor, tx, at, origin }) {
      await record(
        tx,
        {
          at,
          actor,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          data: entry.data,
          origin,
        },
        options,
      );
    },
  };
}
