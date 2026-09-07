// Guards against broken Drizzle migration numbering (PLAN.md follow-up: two
// PRs both claiming migration 0035 caused a real merge conflict that had to
// be hand-resolved). Run via `npm run check:migrations`.
//
// Verifies:
//   1. No two migration files share the same leading number.
//   2. `_journal.json` entries are contiguous (0, 1, 2, ...) and match the
//      files on disk 1:1 — no file missing a journal entry and no journal
//      entry missing its file.

import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "src/db/migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

type JournalEntry = {
  idx: number;
  tag: string;
  [key: string]: unknown;
};

type Journal = {
  entries: JournalEntry[];
  [key: string]: unknown;
};

function fail(message: string): never {
  console.error(`\n❌ Migration check failed: ${message}\n`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fail(`migrations directory not found at ${MIGRATIONS_DIR}`);
  }
  if (!fs.existsSync(JOURNAL_PATH)) {
    fail(`journal file not found at ${JOURNAL_PATH}`);
  }

  const sqlFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const journal: Journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8"));

  // --- 1. No two files share the same leading number -----------------
  const numberToFiles = new Map<string, string[]>();
  const fileNumberPattern = /^(\d+)_/;

  for (const file of sqlFiles) {
    const match = file.match(fileNumberPattern);
    if (!match) {
      fail(`migration file "${file}" does not start with a numeric prefix (expected NNNN_name.sql)`);
    }
    const number = match[1];
    const list = numberToFiles.get(number) ?? [];
    list.push(file);
    numberToFiles.set(number, list);
  }

  const duplicates = [...numberToFiles.entries()].filter(([, files]) => files.length > 1);
  if (duplicates.length > 0) {
    const details = duplicates
      .map(([number, files]) => `  - number ${number} is used by: ${files.join(", ")}`)
      .join("\n");
    fail(
      `duplicate migration numbers detected — rename one of the conflicting files to the next free number:\n${details}`
    );
  }

  // --- 2. Journal entries are contiguous and match files on disk -----
  const sortedEntries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  sortedEntries.forEach((entry, position) => {
    if (entry.idx !== position) {
      fail(
        `_journal.json has a gap or out-of-order idx — expected idx ${position} but found ${entry.idx} (tag "${entry.tag}"). ` +
          `Journal idx values must be contiguous starting at 0.`
      );
    }
  });

  const journalTags = new Set(sortedEntries.map((e) => e.tag));
  const fileTags = new Set(sqlFiles.map((f) => f.replace(/\.sql$/, "")));

  const filesWithoutJournalEntry = [...fileTags].filter((tag) => !journalTags.has(tag));
  if (filesWithoutJournalEntry.length > 0) {
    fail(
      `these migration files have no matching entry in _journal.json: ${filesWithoutJournalEntry
        .map((t) => `${t}.sql`)
        .join(", ")}`
    );
  }

  const journalEntriesWithoutFile = [...journalTags].filter((tag) => !fileTags.has(tag));
  if (journalEntriesWithoutFile.length > 0) {
    fail(
      `these _journal.json entries have no matching .sql file on disk: ${journalEntriesWithoutFile.join(", ")}`
    );
  }

  if (sortedEntries.length !== sqlFiles.length) {
    fail(
      `_journal.json has ${sortedEntries.length} entries but there are ${sqlFiles.length} migration files on disk`
    );
  }

  // --- 3. Journal order matches file numbering ------------------------
  sortedEntries.forEach((entry, position) => {
    const expectedFile = sqlFiles[position];
    const expectedTag = expectedFile.replace(/\.sql$/, "");
    if (entry.tag !== expectedTag) {
      fail(
        `_journal.json entry at idx ${entry.idx} is tagged "${entry.tag}" but the migration file at that position ` +
          `(sorted by filename) is "${expectedFile}". Migration numbering and journal order must match.`
      );
    }
  });

  console.log(`✅ Migration numbering OK — ${sqlFiles.length} migrations, journal contiguous and matching.`);
}

main();
