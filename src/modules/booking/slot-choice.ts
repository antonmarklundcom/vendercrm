// The id carried on each offered slot and echoed back by Meta when the
// customer taps it (plan-booking.md §5.3).
//
// Pure and import-free, like ./notification-chain.ts and ./service-totals.ts,
// because it is a wire format: it has to survive a round trip through Meta
// with no server-side state, so everything needed to make the booking is
// encoded in the string itself. Meta allows 200 characters for a row id,
// which a ULID and an epoch fit inside comfortably.

const PREFIX = "bk";

export type SlotChoice = { bookingTypeId: string; startsAt: Date };

export function encodeSlotChoice(bookingTypeId: string, startsAt: Date): string {
  return `${PREFIX}:${bookingTypeId}:${Math.floor(startsAt.getTime() / 1000)}`;
}

/**
 * Parses a tapped row id, or returns null.
 *
 * Null is the common case and not an error: the webhook sees every
 * interactive reply the tenant's number receives, including buttons from
 * flows this module knows nothing about. Anything unrecognised must be a
 * no-op rather than a guess.
 */
export function decodeSlotChoice(id: string | null | undefined): SlotChoice | null {
  if (!id) return null;
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  if (!parts[1]) return null;
  const seconds = Number(parts[2]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return { bookingTypeId: parts[1], startsAt: new Date(seconds * 1000) };
}
