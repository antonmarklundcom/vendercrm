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
  const NINE = at("2026-09-07T12:00:00.000Z");

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

  const reserve = (typeId: string, extra: Record<string, unknown> = {}) =>
    bookingsModule.reserveBooking(
      ctx,
      {
        bookingTypeId: typeId,
        startsAt: NINE,
        name: "Ana Giménez",
        phone: `+59598${Math.floor(1000000 + Math.random() * 8999999)}`,
        ...extra,
      },
      NOW,
    );

  it("takes exactly capacity bookings at one start, and refuses the next", async () => {
    const type = await makeType({ capacity: 3 });

    // N-1 and N both go through — the old unique index would have rejected
    // the second, which is the whole reason the key gained a seat offset.
    const first = await reserve(type.id);
    const second = await reserve(type.id);
    const third = await reserve(type.id);
    expect([first, second, third].map((r) => r.booking.status)).toEqual([
      "confirmed",
      "confirmed",
      "confirmed",
    ]);
    // And every row still has a distinct active_slot, so the backstop is
    // intact rather than switched off.
    const keys = [first, second, third].map((r) => r.booking.activeSlot);
    expect(new Set(keys).size).toBe(3);

    // N+1 is refused.
    await expect(reserve(type.id)).rejects.toMatchObject({ code: "slotTaken" });
  });

  it("counts a party against the places, not the rows", async () => {
    const type = await makeType({ capacity: 4 });
    await reserve(type.id, { partySize: 3 });
    // Three places gone; a party of two cannot fit in the remaining one.
    await expect(reserve(type.id, { partySize: 2 })).rejects.toMatchObject({
      code: "slotTaken",
    });
    const single = await reserve(type.id, { partySize: 1 });
    expect(single.booking.partySize).toBe(1);
  });

  it("refuses a party larger than the class outright", async () => {
    const type = await makeType({ capacity: 2 });
    await expect(reserve(type.id, { partySize: 5 })).rejects.toMatchObject({
      code: "partyTooLarge",
    });
  });

  it("still refuses the second booking at capacity 1", async () => {
    // The regression guard: the ordinary one-at-a-time type must behave
    // exactly as it did before capacity existed.
    const type = await makeType();
    await reserve(type.id);
    await expect(reserve(type.id)).rejects.toMatchObject({ code: "slotTaken" });
  });

  it("lengthens the booking by the chosen add-ons", async () => {
    const type = await makeType({ allowMultiService: true });
    const barba = await servicesModule.createService(ctx, {
      bookingTypeId: type.id,
      name: "Barba",
      extraDurationMinutes: 15,
      extraPrice: 20000,
    });

    const result = await reserve(type.id, { serviceIds: [barba!.id] });
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

    const result = await reserve(type.id, { serviceIds: [foreign!.id] });
    expect(result.booking.endsAt.getTime() - result.booking.startsAt.getTime()).toBe(
      60 * 60_000,
    );
    expect(result.booking.services).toEqual([]);
  });

  describe("señas", () => {
    it("holds the slot while the deposit is pending", async () => {
      const type = await makeType({ depositAmount: 50000 });
      const held = await reserve(type.id);
      expect(held.booking.status).toBe("pending_deposit");

      // The whole reason `pending_deposit` is in SLOT_HOLDING_STATUSES: two
      // people must not both be asked to pay for the same 09:00.
      await expect(reserve(type.id)).rejects.toMatchObject({ code: "slotTaken" });
    });

    it("confirms on a human's say-so, and is idempotent", async () => {
      const type = await makeType({ depositAmount: 50000 });
      const held = await reserve(type.id);

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
      const held = await reserve(type.id);

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
      const next = await reserve(type.id);
      expect(next.booking.status).toBe("pending_deposit");
    });

    it("never cancels a booking whose deposit was confirmed while the job waited", async () => {
      // The one failure this flow cannot have: a job queued two hours ago
      // must not retire a booking somebody has since paid for.
      const type = await makeType({ depositAmount: 50000 });
      const held = await reserve(type.id);
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
      const held = await reserve(type.id);

      const moved = await bookingsModule.rescheduleBooking(
        ctx,
        held.booking.id,
        at("2026-09-07T13:00:00.000Z"),
        "contact",
        NOW,
      );
      expect(moved.booking.status).toBe("pending_deposit");
    });

    it("does not send a paid booking back to pending when it moves", async () => {
      const type = await makeType({ depositAmount: 50000 });
      const held = await reserve(type.id);
      await depositsModule.confirmDeposit(ctx, held.booking.id);

      const moved = await bookingsModule.rescheduleBooking(
        ctx,
        held.booking.id,
        at("2026-09-07T14:00:00.000Z"),
        "staff",
        NOW,
      );
      expect(moved.booking.status).toBe("confirmed");
    });
  });
});
