import { eq } from "drizzle-orm";
import { bookings } from "@/db/schema";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getBooking } from "./bookings";
import { notifyBooking } from "./notifications";

// The booking reminder (docs/SPEC-BOOKING.md §7). A job, not a cron: it is
// scheduled per booking with a future `run_at`, which is exactly what §2.1
// says a delayed step is.
//
// What this file used to be: a direct free-form WhatsApp send that skipped
// whenever the 24h window was closed — which, for the website visitor who
// has never messaged the business, is always. That limit is gone
// (plan-booking.md §5.1). The reminder now goes through the shared chain in
// ./notifications.ts: approved template first, free-form only as the lucky
// shortcut, email after that, and a logged "no pudimos avisarle" as the
// honest floor. Only the booking-state guards below still live here, because
// they are about *this* job and not about delivery.

export type ReminderPayload = { tenantId: string; bookingId: string };

export type ReminderOutcome =
  | { status: "sent"; channel: "wa_template" | "wa_freeform" | "email" }
  | {
      status: "skipped";
      reason: "not_found" | "not_confirmed" | "already_sent" | "undeliverable";
    };

export async function sendBookingReminder(payload: ReminderPayload): Promise<ReminderOutcome> {
  const ctx = await buildSystemTenantContext(payload.tenantId);
  if (!ctx) return { status: "skipped", reason: "not_found" };

  const booking = await getBooking(ctx, payload.bookingId);
  if (!booking) return { status: "skipped", reason: "not_found" };
  // A cancelled or rescheduled booking must not remind: the job survives the
  // cancellation deliberately (so "why did they get a reminder for a
  // cancelled visit" is answerable), and the guard lives here.
  if (booking.status !== "confirmed") return { status: "skipped", reason: "not_confirmed" };
  if (booking.reminderSentAt) return { status: "skipped", reason: "already_sent" };

  const outcome = await notifyBooking({
    tenantId: ctx.tenantId,
    bookingId: booking.id,
    kind: "reminder",
  });

  if (outcome.status !== "sent" || outcome.channel === "none") {
    // Undeliverable, never failed: a reminder that could not go out must not
    // dead-letter a job or cast doubt on a booking that still stands. The
    // attempt is already on the booking's timeline, which is where staff see
    // it — the difference from before is that it is written down rather than
    // silently dropped.
    return { status: "skipped", reason: "undeliverable" };
  }

  // Stamped only on a real send, so a retry after an undeliverable attempt
  // still has a reminder to send.
  await tenantDb(ctx)
    .update(bookings)
    .set({ reminderSentAt: new Date() })
    .where(eq(bookings.id, booking.id));

  return { status: "sent", channel: outcome.channel };
}
