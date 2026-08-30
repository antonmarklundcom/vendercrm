import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Applying every vertical preset to a fresh tenant (plan-booking.md §6.1).
//
// This is B5's exit criterion, and it is an integration test rather than a
// unit test on purpose: the preset catalogue being well-formed is already
// covered by ./verticals.test.ts without a database. What can only be checked
// here is the claim the wizard actually makes — that picking a rubro leaves
// you with a booking page a stranger can use. So each preset is applied to
// its own tenant and then booked through the public entry points, the same
// ones `(public)/b/[tenant]/[type]` calls.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("applying a vertical preset (MySQL integration)", () => {
  type TenantContext = import("@/modules/tenancy/context").TenantContext;

  let newId: (typeof import("@/lib/ids"))["newId"];
  let applyVerticalPreset: (typeof import("./verticals-apply"))["applyVerticalPreset"];
  let VERTICAL_PRESETS: (typeof import("./verticals"))["VERTICAL_PRESETS"];
  let publicModule: typeof import("@/modules/booking/public");
  let flowsModule: typeof import("@/modules/automations/flows");
  let typesModule: typeof import("@/modules/booking/types");

  // A Tuesday, so that "the next 30 days" covers every weekday a preset can
  // open on, including the Saturday-morning barbería.
  const NOW = new Date("2026-09-01T12:00:00Z");

  beforeAll(async () => {
    ({ newId } = await import("@/lib/ids"));
    ({ applyVerticalPreset } = await import("./verticals-apply"));
    ({ VERTICAL_PRESETS } = await import("./verticals"));
    publicModule = await import("@/modules/booking/public");
    flowsModule = await import("@/modules/automations/flows");
    typesModule = await import("@/modules/booking/types");
  });

  /** A tenant with nothing in it, the state the wizard actually runs against. */
  async function freshTenant(): Promise<{ ctx: TenantContext; slug: string }> {
    const { createTenant } = await import("./tenants");
    const superadmin = { userId: "sa-verticals", impersonatorUserId: null } as const;
    const slug = `vt-${newId().toLowerCase()}`;
    const tenant = await createTenant(superadmin, { name: `Vertical ${newId()}`, slug });
    return {
      ctx: {
        tenantId: tenant!.id,
        userId: "admin-user",
        role: "admin",
        impersonatorUserId: null,
        accessStatus: "active",
      },
      slug,
    };
  }

  // One test per preset rather than one loop inside one test: a failure then
  // names the rubro that broke instead of the first one that happened to run.
  for (const preset of [
    "barberia",
    "clinica",
    "taller",
    "gimnasio",
    "profesionales",
    "generico",
  ]) {
    it(`leaves ${preset} with a public booking page a stranger can book`, async () => {
      const definition = VERTICAL_PRESETS.find((entry) => entry.slug === preset)!;
      const { ctx, slug } = await freshTenant();

      const outcome = await applyVerticalPreset(ctx, preset);
      expect(outcome).not.toHaveProperty("error");
      const applied = outcome as Exclude<typeof outcome, { error: string }>;
      expect(applied.vertical).toBe(preset);
      expect(applied.created.bookingTypes).toBe(definition.bookingTypes.length);
      expect(applied.created.resources).toBe(definition.resources.length);
      expect(applied.created.flows).toBe(definition.flows.length);

      for (const type of definition.bookingTypes) {
        // 1. The page resolves at all — the tenant slug and type slug the
        //    preset promised are the ones the public route can find.
        const page = await publicModule.getPublicBookingType(slug, type.slug);
        expect(page, `${preset}/${type.slug} has no public page`).not.toBeNull();
        expect(page!.type.durationMinutes).toBe(type.durationMinutes);

        // 2. It offers something. A page with no bookable start is the exact
        //    failure this criterion exists to catch: hours that never open,
        //    a type with no resource behind it, a notice window that eats
        //    every slot in range.
        const slots = await publicModule.publicSlots(
          slug,
          type.slug,
          null,
          null,
          `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
          NOW,
        );
        expect(slots.ok, `${preset}/${type.slug} slots: ${JSON.stringify(slots)}`).toBe(true);
        const offered = slots.ok ? slots.data : [];
        expect(offered.length, `${preset}/${type.slug} offered no slots`).toBeGreaterThan(0);

        // A class shows its remaining places; a one-at-a-time type does not
        // have any to show.
        if ((type.capacity ?? 1) > 1) {
          expect(offered[0].seatsRemaining).toBe(type.capacity);
        } else {
          expect(offered[0].seatsRemaining).toBeUndefined();
        }

        // 3. The offered start is actually reservable. Everything above could
        //    pass on a page that still refuses every booking.
        const reserved = await publicModule.publicReserve(
          slug,
          type.slug,
          {
            startsAt: offered[0].startsAt,
            name: "Ana Giménez",
            phone: `+59598${Math.floor(1000000 + Math.random() * 8999999)}`,
          },
          { ipAddress: "10.0.0.9" },
          NOW,
        );
        expect(reserved.ok, `${preset}/${type.slug} reserve: ${JSON.stringify(reserved)}`).toBe(
          true,
        );
        if (reserved.ok) {
          expect(reserved.data.manageToken).toBeTruthy();
          // No preset asks for a seña, so nothing should land held.
          expect(reserved.data.status).toBe("confirmed");
        }
      }
    });
  }

  it("brings both automation flows, published and pointing at real booking types", async () => {
    const { ctx } = await freshTenant();
    await applyVerticalPreset(ctx, "barberia");

    const flows = await flowsModule.listFlows(ctx);
    const noShow = flows.find((flow) => flow.triggerType === "booking_no_show");
    const review = flows.find((flow) => flow.triggerType === "booking_completed");
    expect(noShow, "no reactivation flow").toBeTruthy();
    expect(review, "no review-request flow").toBeTruthy();

    // Active and published, not draft: a flow the admin has to go and switch
    // on is not the behaviour the wizard's card promised.
    for (const flow of [noShow!, review!]) {
      expect(flow.status).toBe("active");
      expect(flow.publishedVersionId).toBeTruthy();
    }

    const types = await typesModule.listBookingTypes(ctx);
    const corte = types.find((type) => type.slug === "corte");

    const noShowGraph = (await flowsModule.getVersion(ctx, noShow!.publishedVersionId!))!
      .graph as { nodes: Array<{ id: string; config: Record<string, unknown> }> };
    const offer = noShowGraph.nodes.find((node) => node.config.kind === "offer_slots");
    // The `offer_slots` action B3 added, wired to a type that exists — a node
    // pointing at a stale or invented id would fail only when a customer
    // finally missed an appointment.
    expect(offer).toBeTruthy();
    expect(offer!.config.bookingTypeId).toBe(corte!.id);

    const reviewGraph = (await flowsModule.getVersion(ctx, review!.publishedVersionId!))!
      .graph as { nodes: Array<{ config: Record<string, unknown> }> };
    const send = reviewGraph.nodes.find((node) => node.config.kind === "send_review_request");
    expect(send).toBeTruthy();
    // The tenant's own review link is substituted at send time, so the stored
    // copy must still carry the placeholder.
    expect(String(send!.config.text)).toContain("{{review_link}}");
    // A review request ends after saying thank you.
    expect(reviewGraph.nodes.some((node) => node.config.kind === "offer_slots")).toBe(false);
  });

  it("adds nothing the second time it is applied", async () => {
    const { ctx } = await freshTenant();

    const first = await applyVerticalPreset(ctx, "gimnasio");
    const second = await applyVerticalPreset(ctx, "gimnasio");

    expect(first).not.toHaveProperty("error");
    expect(second).not.toHaveProperty("error");
    // Forms get double-submitted; the second pass must be a no-op rather than
    // a second set of chairs, stages and flows.
    expect((second as { created: Record<string, number> }).created).toEqual({
      resources: 0,
      bookingTypes: 0,
      services: 0,
      stages: 0,
      tags: 0,
      flows: 0,
    });

    const flows = await flowsModule.listFlows(ctx);
    expect(flows.length).toBe(
      VERTICAL_PRESETS.find((entry) => entry.slug === "gimnasio")!.flows.length,
    );
  });
});
