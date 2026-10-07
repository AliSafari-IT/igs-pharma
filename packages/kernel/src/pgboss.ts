import { type SQL, sql } from "drizzle-orm";

import type { Tx } from "./config";

/** The slice of pg-boss 10's `Db` interface that `send({ db })` uses. */
export interface JobExecutor {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Mirrors node-postgres' parameter handling, which pg-boss relies on: plain objects become JSON. */
function bind(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (
    typeof value === "object" &&
    !(value instanceof Date) &&
    !Array.isArray(value) &&
    !ArrayBuffer.isView(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Adapts a Drizzle/postgres.js transaction to pg-boss's `db` executor, so `boss.send(…, { db })`
 * runs inside OUR transaction and commits or rolls back with it (Q6).
 *
 * pg-boss passes `$1…$n` placeholders; they are rebound as Drizzle parameters in order.
 */
export function pgBossExecutor(tx: Pick<Tx, "execute">): JobExecutor {
  return {
    async executeSql(text, values = []) {
      const chunks: SQL[] = [];
      let last = 0;
      for (const match of text.matchAll(/\$(\d+)/g)) {
        chunks.push(sql.raw(text.slice(last, match.index)));
        chunks.push(sql`${bind(values[Number(match[1]) - 1])}`);
        last = match.index + match[0].length;
      }
      chunks.push(sql.raw(text.slice(last)));
      const result = await tx.execute(sql.join(chunks, sql.raw("")));
      return { rows: Array.from(result as Iterable<unknown>) };
    },
  };
}
