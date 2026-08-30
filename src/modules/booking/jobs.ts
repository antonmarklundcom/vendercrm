import { lt, eq, and } from "drizzle-orm";
import { bookings } from "@/db/schema";
import { enqueue } from "@/lib/queue";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { registerHandler } from "@/worker/handlers";
import { BOOKING_REMINDER_JOB_TYPE } from "./bookings";
import { notifyBooking } from "./notifications";
import {
  BOOKING_NOTIFY_JOB_TYPE,
  registerBookingNotificationTriggers,
  type NotifyJobPayload,
} from "./notification-triggers";
import { sendBookingReminder, type ReminderPayload } from "./reminders";
import {
  BOOKING_DEPOSIT_EXPIRY_JOB_TYPE,
  expireDeposit,
  expireStaleDeposits,
  type DepositExpiryPayload,
} from "./deposits";

// Booking's job handlers (docs/SPEC-BOOKING.md §7/§8), registered at import
// time the way whatsapp/jobs.ts and automations/jobs.ts are.

registerHandler(BOOKING_REMINDER_JOB_TYPE, async (payload) => {
  await sendBookingReminder(payload as ReminderPayload);
});

// Confirmation, reschedule and cancellation notices. Subscribed here rather
// than at the send site so the reservation transaction never waits on Meta,
// and registered from the same module the worker already imports.
registerBookingNotificationTriggers();

registerHandler(BOOKING_NOTIFY_JOB_TYPE, async (payload) => {
  const { tenantId, bookingId, kind } = payload as NotifyJobPayload;
  await notifyBooking({ tenantId, bookingId, kind });
});

// Releasing a hold whose seña never arrived. Scheduled per booking with a
// future run_at, the same shape as the reminder — not a sweep, because the
// window is per booking type.
registerHandler(BOOKING_DEPOSIT_EXPIRY_JOB_TYPE, async (payload) => {
  await expireDeposit(payload as DepositExpiryPayload);
});

export const BOOKING_COMPLETE_JOB_TYPE = "booking.complete_past";
const COMPLETE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Flips past `confirmed` bookings to `completed`, so "no-show rate" has a
 * denominator. It never marks a no-show: nothing in the system knows the
 * customer didn't turn up, and guessing would quietly libel people. Staff can
 * always correct a row back.
 */
export async function completePastBookings(
  tenantId: string,
  now: Date = new Date(),
): Promise<number> {
  const ctx = await buildSystemTenantContext(tenantId);
  if (!ctx) return 0;
  if (ctx.accessStatus !== "active") return 0;

  const stale = await tenantDb(ctx).select(
    bookings,
    and(eq(bookings.status, "confirmed"), lt(bookings.endsAt, now)),
  );

  for (const booking of stale) {
    await tenantDb(ctx)
      .update(bookings)
      .set({ status: "completed", activeSlot: null, updatedAt: now })
      .where(eq(bookings.id, booking.id));
  }

  return stale.length;
}

registerHandler(BOOKING_COMPLETE_JOB_TYPE, async (payload) => {
  const { tenantId } = payload as { tenantId?: string };
  if (tenantId) {
    await completePastBookings(tenantId);
    // Belt and braces for a hold whose own expiry job never ran (worker
    // restart, pruned row). A slot held forever with nobody chasing it is
    // the failure mode `pending_deposit` introduces.
    await expireStaleDeposits(tenantId);
  }
  // Self-rescheduling chain, the same shape maintenance.ts uses — no cron
  // guarantee exists on this platform (§2.1), so the job books its own next
  // run.
  await enqueue(
    BOOKING_COMPLETE_JOB_TYPE,
    payload,
    { tenantId, runAt: new Date(Date.now() + COMPLETE_INTERVAL_MS) },
  );
});
