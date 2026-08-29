// The arithmetic half of add-on services, kept free of imports so it can be
// tested without a database — the same split ./notification-chain.ts and
// ./slots.ts already use. What a ticked add-on *costs* in minutes and
// guaraníes is a pure question; where the add-on came from is not.

/** What is stored on `bookings.services` — a snapshot, not a join. */
export type BookedService = {
  id: string;
  name: string;
  extraDurationMinutes: number;
  extraPrice: number | null;
};

/** Minutes the chosen add-ons add to the type's own duration. */
export function extraDurationOf(services: BookedService[]): number {
  return services.reduce((sum, service) => sum + Math.max(0, service.extraDurationMinutes), 0);
}

/** What the add-ons add to the price, in whole guaraníes. */
export function extraPriceOf(services: BookedService[]): number {
  return services.reduce((sum, service) => sum + (service.extraPrice ?? 0), 0);
}
