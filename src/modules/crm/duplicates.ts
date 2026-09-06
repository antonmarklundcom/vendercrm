// Duplicate contact detection (PLAN.md §15.5 J11c, §17.2/§17.3 P16) — pure
// over rows already read, no fuzzy-matching library (hard limit). Exact
// normalized match only: same email, or same name (case/accents folded)
// with the same first six digits of phone. A tenant who wants fuzzy
// matching gets it in a later phase if asked for; this is the cheap,
// zero-false-positive half.

export type DuplicateCandidateRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
};

export type DuplicatePair = {
  a: DuplicateCandidateRow;
  b: DuplicateCandidateRow;
  reason: "email" | "nameAndPhone";
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Case and accents folded — "José" and "jose" are the same name for this
 *  purpose, since a rep typing a contact by ear rarely gets the accent right
 *  twice the same way. */
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** The first six digits of the (already E.164-normalized) phone — paired
 *  with the name match below, since alone it clusters every contact sharing
 *  a tenant's country code and mobile prefix. */
function phonePrefix(phone: string): string {
  return phoneDigits(phone).slice(0, 6);
}

export function findDuplicateCandidates(rows: DuplicateCandidateRow[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const seenPairKeys = new Set<string>();

  function addPair(a: DuplicateCandidateRow, b: DuplicateCandidateRow, reason: DuplicatePair["reason"]) {
    const key = [a.id, b.id].sort().join(":");
    if (seenPairKeys.has(key)) return;
    seenPairKeys.add(key);
    pairs.push({ a, b, reason });
  }

  const byEmail = new Map<string, DuplicateCandidateRow[]>();
  const byNameAndPhone = new Map<string, DuplicateCandidateRow[]>();

  for (const row of rows) {
    if (row.email) {
      const key = normalizeEmail(row.email);
      const list = byEmail.get(key) ?? [];
      list.push(row);
      byEmail.set(key, list);
    }

    const key = `${normalizeName(row.name)}:${phonePrefix(row.phone)}`;
    const list = byNameAndPhone.get(key) ?? [];
    list.push(row);
    byNameAndPhone.set(key, list);
  }

  for (const group of byEmail.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(group[i]!, group[j]!, "email");
      }
    }
  }

  for (const group of byNameAndPhone.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(group[i]!, group[j]!, "nameAndPhone");
      }
    }
  }

  return pairs;
}
