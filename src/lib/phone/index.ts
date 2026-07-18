// Phone normalization to E.164 with a Paraguay (+595) default (PLAN.md §5).
// Phone is the primary contact identity, so normalization must be deterministic
// and stable — the same human number always maps to the same stored string.

const DEFAULT_COUNTRY_CODE = "595";

export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;

  // Already international.
  if (hasPlus) return `+${digits}`;
  // Local trunk form: 0981... -> +595981...
  if (digits.startsWith("0")) return `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  // Country code without plus: 595981... -> +595981...
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) return `+${digits}`;
  // Bare local number -> assume Paraguay.
  return `+${DEFAULT_COUNTRY_CODE}${digits}`;
}
