import type { AuditPort } from "@igs/kernel";

import { type RecordOptions, record } from "./record";

/**
 * The kernel's `AuditPort` backed by the hash chain. Apps wire it in their composition root:
 * `configureKernel({ audit: createAuditPort({ hmacKey: env.AUDIT_HMAC_KEY }) })`.
 * Entries are written inside the command's transaction, so they commit or roll back with it.
 */
export function createAuditPort(options: RecordOptions): AuditPort {
  return {
    async record(entry, { actor, tx, at }) {
      await record(
        tx,
        {
          at,
          actor,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          data: entry.data,
        },
        options,
      );
    },
  };
}
