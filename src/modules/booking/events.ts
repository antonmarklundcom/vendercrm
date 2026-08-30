import { createEventBus } from "@/lib/events";

// Booking domain events (PLAN.md §5 "events"). A typed function registry, not
// a bus: listeners fan out synchronously and enqueue jobs rather than doing
// work inline. modules/automations/triggers.ts subscribes.

export type BookingEventPayload = {
  tenantId: string;
  bookingId: string;
  bookingTypeId: string;
  contactId: string;
  resourceId: string;
  startsAt: Date;
};

export const bookingEvents = createEventBus<{
  /**
   * `rescheduledFromId` is what makes a move distinguishable from a fresh
   * booking on this bus. A reschedule is cancel + create (bookings.ts), so
   * without it every listener would greet a customer who moved their 15:00
   * to 15:30 as a brand-new reservation.
   */
  "booking.created": BookingEventPayload & {
    rescheduledFromId: string | null;
    /**
     * A booking that asks for a seña is created as `pending_deposit`, and
     * what the customer must be sent is a request for money, not a
     * confirmation of something that isn't confirmed yet.
     */
    status: "confirmed" | "pending_deposit";
  };
  "booking.cancelled": BookingEventPayload & {
    cancelledBy: "contact" | "staff" | "system";
    /** Free text, except for one pair the automation layer reads: `system` +
     * `"rescheduled"` is a move, and fires no cancellation flow. */
    cancelReason: string | null;
  };
  "booking.no_show": BookingEventPayload;
  /**
   * The appointment happened. Staff say so — like `no_show`, nothing in the
   * system knows — and it is the one honest moment to ask for a review.
   */
  "booking.completed": BookingEventPayload;
}>();
