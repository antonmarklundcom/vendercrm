// Pure helpers for the email headers threading depends on (PLAN-EMAIL.md E3).

/** `<abc@x>` → `abc@x`; trims whitespace; empty → null. */
export function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^<+/, "").replace(/>+$/, "").trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

/** A `References` header (or an array of ids) → ids without brackets. */
export function parseMessageIdList(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(" ") : value;
  const bracketed = raw.match(/<[^<>\s]+>/g);
  const parts = bracketed ?? raw.split(/[\s,]+/);
  const ids = parts.map((part) => normalizeMessageId(part)).filter((id): id is string => !!id);
  return [...new Set(ids)];
}

// Reply/forward prefixes in the languages this platform's businesses and
// their customers write in: en, es, pt, sv, de, fr, plus the Outlook
// localized "RV"/"RE" and "Sv"/"Vb". Repeated prefixes ("Re: RE: Fwd:") and
// a counter ("Re[2]:") are stripped too.
const PREFIX = /^\s*(re|rv|res|fw|fwd|enc|tr|sv|vs|vb|aw|wg)\s*(\[\d+\])?\s*:\s*/i;

export function normalizeSubject(subject: string | null | undefined): string {
  let value = (subject ?? "").trim();
  let previous: string;
  do {
    previous = value;
    value = value.replace(PREFIX, "");
  } while (value !== previous);
  return value.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 500);
}

/** `Re: …` for a reply, unless the subject already starts with a prefix. */
export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return PREFIX.test(trimmed) ? trimmed : `Re: ${trimmed}`.trim();
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}
