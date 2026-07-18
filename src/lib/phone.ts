/** Normalizes common Paraguayan phone input formats to E.164 (+595...). */
export function normalizePhonePY(input: string): string {
  const trimmed = input.trim().replace(/[^\d+]/g, "");

  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.startsWith("00")) return `+${trimmed.slice(2)}`;
  if (trimmed.startsWith("595")) return `+${trimmed}`;
  if (trimmed.startsWith("0")) return `+595${trimmed.slice(1)}`;

  return `+595${trimmed}`;
}
