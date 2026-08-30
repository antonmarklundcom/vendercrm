import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Capacity and señas against a real MySQL (plan-booking.md §5.2).
//
// The pure boundary cases live in ./capacity.test.ts. What can only be
// checked here is the part that made this phase risky: the
// `bookings_tenant_active_slot_idx` unique index had to keep catching the
// double-click while letting N genuine bookings share a start, and a
// `pending_deposit` hold had to keep holding its slot.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("capacity and deposits (MySQL integration)", () => {
  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  let newId: (typeof import("@/lib/ids"))["newId"];
  let bookingsModule: typeof import("./bookings");
  let typesModule: typeof import("./types");
  let resourcesModule: typeof import("./resources");
  let servicesModule: typeof import("./services");
  let depositsModule: typeof import("./deposits");

  let ctx: TenantContext;
  let resourceId: string;

  const at = (iso: string) => new Date(iso);
  const NOW = at("2026-09-01T12:00:00Z");

  // The whole file shares one resource, so every test books on its own
  // Monday. Two tests reusing one start would collide for real — the engine
  // is right to refuse that, and it is not what any of these tests is about.
  // Asunción is UTC-3 year round, so 12:00Z is 09:00 local on every Monday
  // here, inside the 08:00–12:00 rule set up below.
  const FIRST_MONDAY = Date.UTC(2026, 8, 7, 12, 0, 0);
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  let weekCursor = 0;
  /** A fresh Monday's 09:00 local, never handed out twice. */
  const nextNine = () => new Date(FIRST_MONDAY + weekCursor++ * WEEK);
  /** A later hour on the same Monday, for the reschedule targets. */
  const hoursAfter = (start: Date, hours: number) =>
    new Date(start.getTime() + hours * 60 * 60 * 1000);

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    bookingsModule = await import("./bookings");
    typesModule = await import("./types");
    resourcesModule = await import("./resources");
    servicesModule = await import("./services");
    depositsModule = await import("./deposits");
    await import("./jobs");

    const { createTenant } = await import("@/modules/tenancy/tenants");
    const superadmin = { userId: "sa-capacity", impersonatorUserId: null } as const;
    const tenant = await createTenant(superadmin, {
      name: `Cap ${newId()}`,
      slug: `cap-${newId().toLowerCase()}`,
    });

    ctx = {
      tenantId: tenant!.id,
      userId: "admin-user",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };

    const resource = await resourcesModule.createResource(ctx, {
      kind: "user",
      userId: "rep-cap",
      name: "Ana",
    });
    resourceId = resource!.id;
    await resourcesModule.replaceAvailabilityRules(ctx, resourceId, [
      { weekday: 1, start: "08:00", end: "12:00" },
    ]);
  });

  async function makeType(overrides: Record<string, unknown> = {}) {
    const type = await typesModule.createBookingType(ctx, {
      name: `Clase ${newId()}`,
      slug: `cl-${newId().toLowerCase()}`,
      durationMinutes: 60,
      slotIncrementMinutes: 60,
      minNoticeMinutes: 0,
      maxAdvanceDays: 365,
      ...overrides,
    });
    await resourcesModule.setResourcesForType(ctx, type!.id, [resourceId]);
    return type!;
  }

  const reserve = (typeId: string, startsAt: Date, extra: Record<string, unknown> = {}) =>
    bookingsModule.reserveBooking(
      ctx,
      {
        bookingTypeId: typeId,
        startsAt,
        name: "Ana Giménez",
        phone: `+59598${Math.floor(1000000 + Math.random() * 8999999)}`,
        ...extra,
      },
      NOW,
    );

  it("takes exactly capacity bookings at one start, and refuses the next", async () => {
    const type = await makeType({ capacity: 3 });
    const nine = nextNine();

    // N-1 and N both go through — the old unique index would have rejected
    // the second, which is the whole reason the key gained a seat offset.
    const first = await reserve(type.id, nine);
    const second = await reserve(type.id, nine);
    const third = await reserve(type.id, nine);
    expect([first, second, third].map((r) => r.booking.status)).toEqual([
      "confirmed",
      "confirmed",
      "confirmed",
    ]);
    // And every row still has a distinct active_slot, so the backstop is
    // intact rather than switched off.
    const keys = [first, second, third].map((r) => r.booking.activeSlot);
    expect(new Set(keys).size).toBe(3);

    // N+1 is refused. A start with no places left is not on offer at all, so
    // the refusal is `slotUnavailable` rather than `slotTaken`; `slotTaken` is
    // what a class with *some* room left says to a party too big for it. Both
    // are the same refusal to every caller — `public.ts` and
    // `whatsapp-booking.ts` handle the two codes identically.
    await expect(reserve(type.id, nine)).rejects.toMatchObject({
      code: "slotUnavailable",
    });
  });

  it("counts a party against the places, not the rows", async () => {
    const type = await makeType({ capacity: 4 });
    const nine = nextNine();
    await reserve(type.id, nine, { partySize: 3 });
    // Three places gone; a party of two cannot fit in the remaining one. The
    // start is still offered — one place is left — so this is `slotTaken`.
    await expect(reserve(type.id, nine, { partySize: 2 })).rejects.toMatchObject({
      code: "slotTaken",
    });
    const single = await reserve(type.id, nine, { partySize: 1 });
    expect(single.booking.partySize).toBe(1);
  });

  it("refuses a party larger than the class outright", async () => {
    const type = await makeType({ capacity: 2 });
    await expect(reserve(type.id, nextNine(), { partySize: 5 })).rejects.toMatchObject({
      code: "partyTooLarge",
    });
  });

  it("still refuses the second booking at capacity 1", async () => {
    // The regression guard: the ordinary one-at-a-time type must behave
    // exactly as it did before capacity existed.
    const type = await makeType();
    const nine = nextNine();
    await reserve(type.id, nine);
    // At capacity 1 the booking is ordinary busy time, so the start leaves the
    // offer entirely — exactly as it did before capacity existed.
    await expect(reserve(type.id, nine)).rejects.toMatchObject({
      code: "slotUnavailable",
    });
  });

  it("lengthens the booking by the chosen add-ons", async () => {
    const type = await makeType({ allowMultiService: true });
    const barba = await servicesModule.createService(ctx, {
      bookingTypeId: type.id,
      name: "Barba",
      extraDurationMinutes: 15,
      extraPrice: 20000,
    });

    const result = await reserve(type.id, nextNine(), { serviceIds: [barba!.id] });
    expect(result.booking.endsAt.getTime() - result.booking.startsAt.getTime()).toBe(
      75 * 60_000,
    );
    expect(result.booking.services).toMatchObject([{ id: barba!.id, name: "Barba" }]);
  });

  it("ignores an add-on belonging to another booking type", async () => {
    // The body is not trusted: an id from elsewhere must not stretch this
    // booking's duration.
    const type = await makeType({ allowMultiService: true });
    const other = await makeType({ allowMultiService: true });
    const foreign = await servicesModule.createService(ctx, {
      bookingTypeId: other.id,
      name: "Ajeno",
      extraDurationMinutes: 60,
    });

    const result = await reserve(type.id, nextNine(), { serviceIds: [foreign!.id] });
    expect(result.booking.endsAt.getTime() - result.booking.startsAt.getTime()).toBe(
      60 * 60_000,
    );
    expect(result.booking.services).toEqual([]);
  });

  describe("señas", () => {
    it("holds the slot while the deposit is pending", async () => {
      const type = await makeType({ depositAmount: 50000 });
      const nine = nextNine();
      const held = await reserve(type.id, nine);
      expect(held.booking.status).toBe("pending_deposit");

      // The whole reason `pending_deposit` is in SLOT_HOLDING_STATUSES: two
      // people must not both be asked to pay for the same 09:00. The hold is
      // busy time like any other, so the start is simply no longer offered.
      await expect(reserve(type.id, nine)).rejects.toMatchObject({
        code: "slotUnavailable",
      });
    });

    it("confirms on a human's say-so, and is idempotent", async () => {
      const type = await makeType({ depositAmount: 50000 });
      const held = await reserve(type.id, nextNine());

      const confirmed = await depositsModule.confirmDeposit(ctx, held.booking.id);
      expect(confirmed!.status).toBe("confirmed");
      expect(confirmed!.depositConfirmedAt).toBeTruthy();
      expect(confirmed!.depositConfirmedByUserId).toBe(ctx.userId);

      // Two staff members looking at the same comprobante is normal.
      const again = await depositsModule.confirmDeposit(ctx, held.booking.id);
      expect(again!.status).toBe("confirmed");
    });

    it("releases the slot when the deposit never arrives", async () => {
      const type = await makeType({ depositAmount: 50000 });
      const nine = nextNine();
      const held = await reserve(type.id, nine);

      expect(
        await depositsModule.expireDeposit({
          tenantId: ctx.tenantId,
          bookingId: held.booking.id,
        }),
      ).toBe("expired");

      const after = await bookingsModule.getBooking(ctx, held.booking.id);
      expect(after!.status).toBe("cancelled");
      expect(after!.activeSlot).toBeNull();
      // Freed, not merely marked: the slot is bookable again.
      const next = await reserve(type.id, nine);
      expect(next.booking.status).toBe("pending_deposit");
    });

    it("never cancels a booking whose deposit was confirmed while the job waited", async () => {
      // The one failure this flow cannot have: a job queued two hours ago
      // must not retire a booking somebody has since paid for.
      const type = await makeType({ depositAmount: 50000 });
      const held = await reserve(type.id, nextNine());
      await depositsModule.confirmDeposit(ctx, held.booking.id);

      expect(
        await depositsModule.expireDeposit({
          tenantId: ctx.tenantId,
          bookingId: held.booking.id,
        }),
      ).toBe("skipped");
      expect((await bookingsModule.getBooking(ctx, held.booking.id))!.status).toBe("confirmed");
    });

    it("carries a pending deposit through a reschedule instead of re-asking", async () => {
      const type = await makeType({ depositAmount: 50000 });
      const nine = nextNine();
      const held = await reserve(type.id, nine);

      const moved = await bookingsModule.rescheduleBooking(
        ctx,
        held.booking.id,
        hoursAfter(nine, 1),
        "contact",
        NOW,
      );
      expect(moved.booking.status).toBe("pending_deposit");
    });

    it("does not send a paid booking back to pending when it moves", async () => {
      const type = await makeType({ depositAmount: 50000 });
      const nine = nextNine();
      const held = await reserve(type.id, nine);
      await depositsModule.confirmDeposit(ctx, held.booking.id);

      const moved = await bookingsModule.rescheduleBooking(
        ctx,
        held.booking.id,
        hoursAfter(nine, 2),
        "staff",
        NOW,
      );
      expect(moved.booking.status).toBe("confirmed");
    });
  });
});
