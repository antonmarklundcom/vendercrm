// Shared money math for line-item documents (quotes, notas de venta).
// Pure and free of the db client so it can be imported — and unit-tested —
// without a configured environment.
//
// All amounts are integer minor units with a separate currency code (§2.3).
// PYG has 0 decimals, so for the default currency these are whole guaraníes.
// Nothing here ever produces a fraction: every operation is integer
// arithmetic, because a rounding error in a document a customer receives is
// not a rounding error, it's a wrong number.

export type LineInput = {
  productId?: string;
  description: string;
  qty: number;
  unitPrice: number;
};

export type ComputedLine = LineInput & { lineTotal: number };

export type ComputedTotals = {
  lines: ComputedLine[];
  subtotal: number;
  discount: number;
  total: number;
};

/**
 * A line as the builder holds it: raw strings, exactly what the inputs
 * contain and exactly what gets posted. The builder never converts to a
 * number on the way out — the server parses the strings itself and recomputes
 * every total from them.
 */
export type RawLineInput = {
  productId?: string;
  description: string;
  qty: string;
  unitPrice: string;
};

/**
 * Accepts amounts the way people in Paraguay write them: "1.500.000",
 * "Gs. 1.500.000", "₲ 250 000". A dot is a thousands separator there, not a
 * decimal point, so dots are dropped only when they sit in thousands
 * positions — "1.5" is left alone and still fails as a fraction. Anything it
 * doesn't recognise comes back unchanged for the caller to reject.
 */
export function normalizeAmountInput(raw: string): string {
  const stripped = raw
    .trim()
    .replace(/^(gs\.?|₲|pyg)\s*/i, "")
    .replace(/\s+/g, "");
  if (/^\d{1,3}(\.\d{3})+$/.test(stripped)) return stripped.replace(/\./g, "");
  return stripped;
}

/** The string half of an amount field: normalised, otherwise untouched, so
 * zod's own coercion and messages still decide what is valid. */
export function preprocessAmount(value: unknown): unknown {
  return typeof value === "string" ? normalizeAmountInput(value) : value;
}

/**
 * Parses one raw form value the way the server's zod schema will
 * (`z.coerce.number().int()`), and returns null for anything it would
 * reject — a decimal like `150000.5`, a sign, a stray letter. Amounts are
 * integer minor units (§2.3), so there is no honest number to show for a
 * fractional guaraní: the caller renders a placeholder instead of a total the
 * server would never store.
 */
export function parseMinorUnits(raw: string): number | null {
  const value = Number(normalizeAmountInput(raw));
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * The builder's live preview. Mirrors the server's own reading of the posted
 * form — drop the blank rows, coerce each amount, apply the same clamped
 * discount math — and returns null when any value the server will reject is
 * present, so the display goes blank rather than showing a total that the
 * stored document won't match.
 */
export function previewTotals(
  rawLines: RawLineInput[],
  rawDiscount: string,
): ComputedTotals | null {
  const discount = parseMinorUnits(rawDiscount);
  if (discount === null || discount < 0) return null;

  const items: LineInput[] = [];
  for (const line of rawLines) {
    // Blank rows are "not filled in yet" — the server drops them too, so an
    // untouched extra row must not blank the preview.
    if (line.description.trim().length === 0) continue;
    const qty = parseMinorUnits(line.qty);
    const unitPrice = parseMinorUnits(line.unitPrice);
    if (qty === null || qty < 1 || unitPrice === null || unitPrice < 0) return null;
    items.push({ productId: line.productId, description: line.description, qty, unitPrice });
  }

  return computeLineTotals(items, discount);
}

/** Totals are derived here, never taken from the client. */
export function computeLineTotals(items: LineInput[], discount = 0): ComputedTotals {
  const lines = items.map((item) => ({
    ...item,
    lineTotal: item.qty * item.unitPrice,
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  // A discount larger than the subtotal would produce a negative total,
  // which is never a real document — clamp instead of trusting the input.
  const appliedDiscount = Math.min(Math.max(discount, 0), subtotal);
  return { lines, subtotal, discount: appliedDiscount, total: subtotal - appliedDiscount };
}
