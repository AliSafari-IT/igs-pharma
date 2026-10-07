/**
 * Typing for the values the global setup `provide()`s to tests, so `inject("igsTest…")` is typed in
 * every package that uses the harness (a module augmentation is only visible to programs that
 * include this file — `index.ts` and `global-setup.ts` both import it for types).
 */
declare module "vitest" {
  export interface ProvidedContext {
    /** Connection URL (superuser) to the throw-away Postgres server for this test run. */
    igsTestAdminUrl: string;
    /** Name of the migrated template database (per-file databases are cloned from it). */
    igsTestTemplateDb: string;
    /** Name of the shared, migrated database used by `withTestTx()`. */
    igsTestSharedDb: string;
    /** Prefix of every database created in this run (used for cleanup). */
    igsTestPrefix: string;
  }
}

export {};
