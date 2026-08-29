import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The notification layer against a real MySQL (plan-booking.md §5.1): the
// chain picks a rung, writes down what it did, and one tenant's timeline is
// never visible to another (PLAN.md §3.3 layer 3 merge gate).
//
// The behaviour that matters most here is the one this phase exists to fix:
// a booking made on the website, by someone who has never messaged the
// business, used to produce *silence*. It must now produce either a delivery
// or a written-down reason.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("booking notifications (MySQL integration)", () => {
  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  let newId: (typeof import("@/lib/ids"))["newId"];
  let notifications: typeof import("./notifications");
  let bookingsModule: typeof import("./bookings");
  let typesModule: typeof import("./types");
  let resourcesModule: typeof import("./resources");

  let ctx: TenantContext;
  let elsewhere: TenantContext;
  let resourceId: string;

  const at = (iso: string) => new Date(iso);
  const NOW = at("2026-09-01T12:00:00Z");

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    notifications = await import("./notifications");
    bookingsModule = await import("./bookings");
    typesModule = await import("./types");
    resourcesModule = await import("./resources");
    // Registers the booking.* job handlers *and* subscribes the notification
    // listeners — the same import the worker does, and without it a booking
    // would queue nothing here.
    await import("./jobs");

    const { createTenant } = await import("@/modules/tenancy/tenants");
    const superadmin = { userId: "sa-booking-notif", impersonatorUserId: null } as const;

    const tenant = await createTenant(superadmin, {
      name: `Notif ${newId()}`,
      slug: `nbk-${newId().toLowerCase()}`,
    });
    const other = await createTenant(superadmin, {
      name: `Other ${newId()}`,
      slug: `onbk-${newId().toLowerCase()}`,
    });

    ctx = {
      tenantId: tenant!.id,
      userId: "admin-user",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
    elsewhere = { ...ctx, tenantId: other!.id };

    const resource = await resourcesModule.createResource(ctx, {
      kind: "user",
      userId: "rep-one",
      name: "Ana",
    });
    resourceId = resource!.id;
    await resourcesModule.replaceAvailabilityRules(ctx, resourceId, [
      { weekday: 1, start: "08:00", end: "12:00" },
    ]);
  });

  async function makeBooking(overrides: { email?: string } = {}) {
    const type = await typesModule.createBookingType(ctx, {
      name: `Consulta ${newId()}`,
      slug: `n-${newId().toLowerCase()}`,
      durationMinutes: 30,
      minNoticeMinutes: 0,
      maxAdvanceDays: 365,
    });
    await resourcesModule.setResourcesForType(ctx, type!.id, [resourceId]);

    const result = await bookingsModule.reserveBooking(
      ctx,
      {
        bookingTypeId: type!.id,
        startsAt: at("2026-09-07T11:00:00.000Z"),
        name: "Ana Giménez",
        phone: `+59598${Math.floor(1000000 + Math.random() * 8999999)}`,
        ...overrides,
      },
      NOW,
    );
    return result.booking;
  }

  it("records a reason instead of going quiet when nothing can reach the customer", async () => {
    // No WhatsApp account connected and no email on the contact: the old
    // reminder returned `skipped` and left nothing behind, so staff had no
    // way to know the customer was never told.
    const booking = await makeBooking();
    const outcome = await notifications.notifyBooking({
      tenantId: ctx.tenantId,
      bookingId: booking.id,
      kind: "confirmation",
    });

    expect(outcome).toEqual({ channel: "none", status: "skipped", detail: "no_channel" });

    const timeline = await notifications.listBookingNotifications(ctx, booking.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      kind: "confirmation",
      channel: "none",
      status: "skipped",
      detail: "no_channel",
    });
  });

  it("tries email when the contact has one and WhatsApp cannot be used", async () => {
    // lib/email no-ops (and returns false) without RESEND_API_KEY, which is
    // exactly the state a fresh prod deploy is in — so the assertion is on
    // the *rung that was attempted*, which the timeline records either way,
    // rather than on Resend being configured in CI.
    const booking = await makeBooking({ email: `ana-${newId()}@example.com` });
    const outcome = await notifications.notifyBooking({
      tenantId: ctx.tenantId,
      bookingId: booking.id,
      kind: "confirmation",
    });

    const timeline = await notifications.listBookingNotifications(ctx, booking.id);
    expect(timeline.some((row) => row.channel === "email")).toBe(true);
    expect(["sent", "skipped"]).toContain(outcome.status);
  });

  it("keeps one tenant's delivery timeline invisible to another", async () => {
    const booking = await makeBooking();
    await notifications.notifyBooking({
      tenantId: ctx.tenantId,
      bookingId: booking.id,
      kind: "confirmation",
    });

    expect(await notifications.listBookingNotifications(ctx, booking.id)).not.toHaveLength(0);
    expect(await notifications.listBookingNotifications(elsewhere, booking.id)).toHaveLength(0);

    const batch = await notifications.notificationsByBooking(elsewhere, [booking.id]);
    expect(batch.get(booking.id)).toBeUndefined();
  });

  it("logs a confirmation for every booking the public page creates", async () => {
    // The listener enqueues rather than sending, so the proof that a
    // confirmation is on its way is a job row, not a notification row.
    const booking = await makeBooking();
    const { db } = await import("@/db/client");
    const { jobs } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");

    const rows = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, ctx.tenantId), eq(jobs.type, "booking.notify")));

    const forThisBooking = rows.filter(
      (row) => (row.payload as { bookingId?: string }).bookingId === booking.id,
    );
    expect(forThisBooking).toHaveLength(1);
    expect((forThisBooking[0].payload as { kind?: string }).kind).toBe("confirmation");
  });

  it("calls a move a reschedule, not a second confirmation", async () => {
    const booking = await makeBooking();
    const moved = await bookingsModule.rescheduleBooking(
      ctx,
      booking.id,
      at("2026-09-07T11:30:00.000Z"),
      "contact",
      NOW,
    );

    const { db } = await import("@/db/client");
    const { jobs } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, ctx.tenantId), eq(jobs.type, "booking.notify")));

    const kinds = rows
      .filter((row) => {
        const payload = row.payload as { bookingId?: string };
        return payload.bookingId === moved.booking.id || payload.bookingId === booking.id;
      })
      .map((row) => (row.payload as { kind?: string }).kind);

    // The new row is a reschedule; the cancel half of the move must not have
    // queued a "sentimos que cancelaste".
    expect(kinds).toContain("reschedule");
    expect(kinds).not.toContain("cancellation");
  });

  it("does not stamp reminderSentAt when the reminder could not be delivered", async () => {
    // Otherwise an undeliverable attempt silently consumes the reminder and
    // a retry has nothing left to send.
    const booking = await makeBooking();
    const { sendBookingReminder } = await import("./reminders");
    const outcome = await sendBookingReminder({
      tenantId: ctx.tenantId,
      bookingId: booking.id,
    });

    expect(outcome).toEqual({ status: "skipped", reason: "undeliverable" });
    const after = await bookingsModule.getBooking(ctx, booking.id);
    expect(after!.reminderSentAt).toBeNull();

    // And the attempt is on the timeline rather than nowhere.
    const timeline = await notifications.listBookingNotifications(ctx, booking.id);
    expect(timeline.some((row) => row.kind === "reminder")).toBe(true);
  });
});
