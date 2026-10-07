import { closeDb, getDb } from "@igs/db/client";
import { sql } from "drizzle-orm";

/** Fails if the database is unreachable (worker start-up check). */
export async function checkDatabase(): Promise<void> {
  await getDb().execute(sql`SELECT 1`);
}

/** Closes the connection pool on graceful shutdown. */
export async function closeDatabase(): Promise<void> {
  await closeDb();
}
