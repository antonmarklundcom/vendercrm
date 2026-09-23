// Parsing a pasted list of domains for console provisioning
// (console-provision.ts). Pure, so it is tested without a database.

/** A pasted line: `domain[, Display name]`. */
export type DomainEntry = { domain: string; name: string };

export type ParsedDomainList = {
  entries: DomainEntry[];
  /** Lines that were not a domain, verbatim, so the page can say which. */
  invalid: string[];
  /** Domains that appeared more than once; only the first is kept. */
  duplicates: string[];
};

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function normalizeDomain(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0] ?? ""
  );
}

/** `dentista-luque.com.py` → `Dentista luque`, the script's rule. */
export function displayNameFor(domain: string): string {
  const label = (domain.split(".")[0] ?? domain).replace(/-/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The scripts/domains.txt format, forgiving about what people paste: blank
 * lines and `#` comments are skipped, a URL is reduced to its host, and a
 * name after a comma (or a tab, from a spreadsheet) is kept.
 */
export function parseDomainList(text: string): ParsedDomainList {
  const entries: DomainEntry[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [first = "", ...rest] = line.split(/[,\t]/);
    const domain = normalizeDomain(first);
    if (!DOMAIN_RE.test(domain)) {
      invalid.push(line);
      continue;
    }
    if (seen.has(domain)) {
      duplicates.push(domain);
      continue;
    }
    seen.add(domain);
    const name = rest.join(",").trim().slice(0, 200);
    entries.push({ domain, name: name || displayNameFor(domain) });
  }

  return { entries, invalid, duplicates };
}
