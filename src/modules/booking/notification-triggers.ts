import { enqueue } from "@/lib/queue";
import { bookingEvents } from "./events";

// Who decides that a customer gets told about their booking.
//
// The listeners enqueue, they never send: the chain in ./notifications.ts
// talks to Meta and to Resend, and a reservation must not wait on either —
// nor be rolled back when one of them is down. Same shape as
// automations/triggers.ts, including the idempotency latch, because the
// worker and the Next server both import this module.

export const BOOKING_NOTIFY_JOB_TYPE = "booking.notify";

export type NotifyJobPayload = {
  tenantId: string;
  bookingId: string;
  kind: "confirmation" | "reschedule" | "cancellation" | "deposit_request" | "review_request";
};

let registered = false;

export function registerBookingNotificationTriggers() {
  if (registered) return;
  registered = true;

  bookingEvents.on("booking.created", async ({ tenantId, bookingId, rescheduledFromId }) => {
    // A reschedule arrives here as a *new* booking (cancel + create linked
    // by `rescheduled_from_id`, docs/SPEC-BOOKING.md), so the one event has
    // to answer two questions. Telling a customer who moved their 15:00 to
    // 15:30 that their reservation "quedó confirmada" is technically true
    // and reads like the move failed.
    await enqueue(
      BOOKING_NOTIFY_JOB_TYPE,
      {
        tenantId,
        bookingId,
        kind: rescheduledFromId ? "reschedule" : "confirmation",
      } satisfies NotifyJobPayload,
      { tenantId },
    );
  });

  bookingEvents.on(
    "booking.cancelled",
    async ({ tenantId, bookingId, cancelledBy, cancelReason }) => {
      // The cancel half of a reschedule is bookkeeping, not a cancellation —
      // the same pair automations/triggers.ts filters on, for the same
      // reason: the customer is about to get the reschedule notice instead.
      if (cancelledBy === "system" && cancelReason === "rescheduled") return;
      await enqueue(
        BOOKING_NOTIFY_JOB_TYPE,
        { tenantId, bookingId, kind: "cancellation" } satisfies NotifyJobPayload,
        { tenantId },
      );
    },
  );
}
