/**
 * `pnpm db:check` part 2 (igs-pharma#77): the Drizzle journal must be applicable. See `checkJournal`.
 */
import { fileURLToPath } from "node:url";

import { checkJournal } from "../src/journal";

const problems = checkJournal(fileURLToPath(new URL("../drizzle", import.meta.url)));
if (problems.length > 0) {
  process.stderr.write(
    `Migration journal problems:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  "Migration journal is consistent: strictly increasing, every entry has its SQL and snapshot.\n",
);
