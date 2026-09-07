// Contract body rendering (PLAN.md §15.2, §17.3 P13) — pure, no db client, so
// it is unit-testable without a configured environment (same discipline as
// documents/types.ts).
//
// Bodies are plain text, never Markdown or HTML: a tenant-authored template
// reaches a public page, and a Markdown/HTML library is one more thing a
// tenant's own copy could break out of. `#` at the start of a line is a
// heading; a blank line separates paragraphs; `{{variable}}` tokens resolve
// against the flow variable registry as it exists when this phase runs.

export type ContractBlock = { type: "heading"; text: string } | { type: "paragraph"; text: string };

/** Splits a template body into headings and paragraphs for the PDF/public
 *  renderers — never HTML, so this is the only place that structure exists. */
export function parseContractBody(text: string): ContractBlock[] {
  const blocks: ContractBlock[] = [];
  for (const raw of text.split(/\n{2,}/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      blocks.push({ type: "heading", text: trimmed.replace(/^#+\s*/, "") });
    } else {
      blocks.push({ type: "paragraph", text: trimmed });
    }
  }
  return blocks;
}

const VARIABLE_PATTERN = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

/** Every `{{variable}}` name referenced in a body, lower-cased, deduplicated —
 *  what template save validates against the known set. */
export function extractVariableNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    names.add(match[1]!.toLowerCase());
  }
  return [...names];
}

const CONTACT_FIELD_VARIABLES = new Set(["contacto.nombre", "contacto.telefono", "contacto.email"]);
const CUSTOM_VARIABLE = /^contacto\.custom\.([a-z0-9_]+)$/;

/**
 * Whether a variable name is one this phase's registry can resolve.
 * `negocio.*` is not part of it yet — it arrives with K3, later in the same
 * lane (§17.2) — so a template referencing it is refused here, by design,
 * until then.
 */
export function isKnownVariable(name: string, customFieldKeys: readonly string[]): boolean {
  const key = name.toLowerCase();
  if (CONTACT_FIELD_VARIABLES.has(key)) return true;
  const match = key.match(CUSTOM_VARIABLE);
  return match ? customFieldKeys.includes(match[1]!) : false;
}

/** The first name in `text` unknown to `customFieldKeys`, or null when every
 *  variable resolves — what a save action reports back to the tenant. */
export function findUnknownVariable(
  text: string,
  customFieldKeys: readonly string[],
): string | null {
  for (const name of extractVariableNames(text)) {
    if (!isKnownVariable(name, customFieldKeys)) return name;
  }
  return null;
}

export type ContractVariableValues = {
  contacto: {
    nombre: string;
    telefono: string;
    email: string;
    custom: Record<string, unknown> | null | undefined;
  };
};

/** Resolves every `{{variable}}` in `text`. Assumes `text` was already
 *  validated (`findUnknownVariable` at save time) — an unresolved token here
 *  renders as an empty string rather than throwing, since a rendered contract
 *  must never fail to produce a document for the visitor. */
export function renderContractBody(text: string, values: ContractVariableValues): string {
  return text.replace(VARIABLE_PATTERN, (match, rawName: string) => {
    const key = rawName.toLowerCase();
    if (key === "contacto.nombre") return values.contacto.nombre;
    if (key === "contacto.telefono") return values.contacto.telefono;
    if (key === "contacto.email") return values.contacto.email;

    const custom = key.match(CUSTOM_VARIABLE);
    if (custom) {
      const value = (values.contacto.custom ?? {})[custom[1]!];
      return value === undefined || value === null ? "" : String(value);
    }

    return match;
  });
}
