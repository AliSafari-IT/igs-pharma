import fs from "node:fs";
import path from "node:path";

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
}

/**
 * Problems in a Drizzle migrations folder that would make a migration silently never run or the
 * chain unreproducible (igs-pharma#77). Drizzle applies only migrations whose `when` is newer than
 * the last applied one, so an entry whose `when` is not strictly greater than its predecessor's
 * would be skipped on every database that already ran the later one. Empty array = fine.
 *
 * - `idx` runs 0, 1, 2, … without gaps and `when` is strictly increasing;
 * - every entry has `<tag>.sql` and `meta/<idx>_snapshot.json`;
 * - every `.sql` file in the folder has a journal entry (an orphan would never run).
 */
export function checkJournal(folder: string): string[] {
  const problems: string[] = [];
  const journalPath = path.join(folder, "meta", "_journal.json");
  let entries: JournalEntry[];
  try {
    entries = (JSON.parse(fs.readFileSync(journalPath, "utf8")) as { entries: JournalEntry[] })
      .entries;
  } catch {
    return [`cannot read ${journalPath}`];
  }

  let previous: JournalEntry | undefined;
  entries.forEach((entry, position) => {
    const label = `${String(entry.idx).padStart(4, "0")} ${entry.tag}`;
    if (entry.idx !== position) problems.push(`${label}: idx ${entry.idx} is not ${position}`);
    if (previous && !(entry.when > previous.when)) {
      problems.push(
        `${label}: when ${entry.when} is not greater than ${previous.when} of ${previous.tag}; Drizzle would skip it`,
      );
    }
    if (!fs.existsSync(path.join(folder, `${entry.tag}.sql`)))
      problems.push(`${label}: ${entry.tag}.sql is missing`);
    const snapshot = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
    if (!fs.existsSync(path.join(folder, "meta", snapshot)))
      problems.push(`${label}: meta/${snapshot} is missing`);
    previous = entry;
  });

  const tags = new Set(entries.map((entry) => entry.tag));
  for (const file of fs.readdirSync(folder)) {
    if (file.endsWith(".sql") && !tags.has(file.slice(0, -4))) {
      problems.push(`${file} has no journal entry and would never run`);
    }
  }
  return problems;
}
