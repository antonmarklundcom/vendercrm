import type { TenantContext } from "@/modules/tenancy/context";
import { createTag, listTags } from "@/modules/crm/contacts";
import { createPipelineWithDefaultStages, listPipelines, listStagesForPipeline, createStage } from "@/modules/crm/pipelines";
import {
  createResource,
  listResources,
  replaceAvailabilityRules,
  listAvailabilityRules,
} from "@/modules/booking/resources";
import { createBookingType, listBookingTypes } from "@/modules/booking/types";
import { setResourcesForType } from "@/modules/booking/resources";
import { createService, listServicesForType } from "@/modules/booking/services";
import { updateTenantVertical } from "./settings";
import { findPreset, type VerticalPreset } from "./verticals";

// Applying a preset (plan-booking.md §6.1).
//
// Two rules govern everything below, and both exist because this runs
// against a tenant that may already have real data in it:
//
//   1. **Additive.** Nothing is deleted, renamed or overwritten. An admin who
//      picks the wrong rubro, or picks a second one out of curiosity, ends up
//      with extra rows they can delete — never with their booking types gone.
//   2. **Idempotent.** Every step checks for what it would create and skips
//      it. Applying the same preset twice is a no-op, which matters because
//      the wizard is a form and forms get double-submitted.
//
// The cost is that a preset cannot "fix" a tenant who has already
// half-configured themselves. That is the right trade: a wizard that
// silently replaced someone's availability would be a support incident, and
// the extra rows are visible and removable.

export type ApplyOutcome = {
  vertical: string;
  created: {
    resources: number;
    bookingTypes: number;
    services: number;
    stages: number;
    tags: number;
  };
};

export async function applyVerticalPreset(
  ctx: TenantContext,
  slug: string,
): Promise<ApplyOutcome | { error: "unknown_vertical" }> {
  const preset = findPreset(slug);
  if (!preset) return { error: "unknown_vertical" };

  const created = {
    resources: await applyResources(ctx, preset),
    bookingTypes: 0,
    services: 0,
    stages: await applyStages(ctx, preset),
    tags: await applyTags(ctx, preset),
  };

  const types = await applyBookingTypes(ctx, preset);
  created.bookingTypes = types.types;
  created.services = types.services;

  // Recorded last, so a half-applied preset (a crash mid-way) does not claim
  // to have been applied. Settings only — no migration, per §2.
  await updateTenantVertical(ctx, preset.slug);

  return { vertical: preset.slug, created };
}

async function applyResources(ctx: TenantContext, preset: VerticalPreset): Promise<number> {
  const existing = await listResources(ctx);
  const byName = new Set(existing.map((row) => row.name.toLowerCase()));
  let count = 0;

  for (const name of preset.resources) {
    if (byName.has(name.toLowerCase())) continue;
    // `resource`, not `user`: a chair, a bay and a room are things, and a
    // thing must not burn a plan seat.
    const resource = await createResource(ctx, { kind: "resource", name });
    if (!resource) continue;
    count += 1;
    await replaceAvailabilityRules(
      ctx,
      resource.id,
      preset.hours.map((rule) => ({
        weekday: rule.weekday,
        start: rule.start,
        end: rule.end,
      })),
    );
  }

  // A tenant whose resources all already existed still wants the preset's
  // hours — but only on resources that have none, since overwriting a
  // configured schedule would break rule 1 above.
  for (const resource of existing) {
    const rules = await listAvailabilityRules(ctx);
    const hasOwn = rules.some((rule) => rule.resourceId === resource.id);
    if (hasOwn) continue;
    await replaceAvailabilityRules(
      ctx,
      resource.id,
      preset.hours.map((rule) => ({
        weekday: rule.weekday,
        start: rule.start,
        end: rule.end,
      })),
    );
  }

  return count;
}

async function applyBookingTypes(
  ctx: TenantContext,
  preset: VerticalPreset,
): Promise<{ types: number; services: number }> {
  const existing = await listBookingTypes(ctx);
  const bySlug = new Set(existing.map((row) => row.slug));
  const resources = await listResources(ctx);

  let types = 0;
  let services = 0;

  for (const definition of preset.bookingTypes) {
    if (bySlug.has(definition.slug)) continue;

    const type = await createBookingType(ctx, {
      name: definition.name,
      slug: definition.slug,
      description: definition.description ?? null,
      durationMinutes: definition.durationMinutes,
      bufferAfterMinutes: definition.bufferAfterMinutes ?? 0,
      minNoticeMinutes: definition.minNoticeMinutes ?? 120,
      capacity: definition.capacity ?? 1,
      allowMultiService: definition.allowMultiService ?? false,
      locationMode: definition.locationMode ?? "in_person",
    });
    if (!type) continue;
    types += 1;

    // Every type serves every resource the preset made. A barbería with two
    // chairs wants either chair to take a corte; narrowing that is a choice
    // the admin makes afterwards, not one a preset should make for them.
    if (resources.length > 0) {
      await setResourcesForType(
        ctx,
        type.id,
        resources.map((resource) => resource.id),
      );
    }

    for (const [index, service] of (definition.services ?? []).entries()) {
      const already = await listServicesForType(ctx, type.id);
      if (already.some((row) => row.name.toLowerCase() === service.name.toLowerCase())) continue;
      await createService(ctx, {
        bookingTypeId: type.id,
        name: service.name,
        extraDurationMinutes: service.extraDurationMinutes,
        extraPrice: service.extraPrice,
        sort: index,
      });
      services += 1;
    }
  }

  return { types, services };
}

/**
 * Adds the preset's stages to the tenant's first pipeline, creating one only
 * if they have none at all.
 *
 * Appended rather than replacing the default stage set: a tenant's board may
 * already have deals sitting on stages, and deleting a stage with deals on it
 * is the one thing this must never do.
 */
async function applyStages(ctx: TenantContext, preset: VerticalPreset): Promise<number> {
  if (preset.pipelineStages.length === 0) return 0;

  let pipelines = await listPipelines(ctx);
  if (pipelines.length === 0) {
    await createPipelineWithDefaultStages(ctx, "Ventas");
    pipelines = await listPipelines(ctx);
  }
  const pipeline = pipelines[0];
  if (!pipeline) return 0;

  const stages = await listStagesForPipeline(ctx, pipeline.id);
  const byName = new Set(stages.map((stage) => stage.name.toLowerCase()));
  let count = 0;
  let position = stages.length;

  for (const name of preset.pipelineStages) {
    if (byName.has(name.toLowerCase())) continue;
    await createStage(ctx, { pipelineId: pipeline.id, name, position });
    position += 1;
    count += 1;
  }

  return count;
}

async function applyTags(ctx: TenantContext, preset: VerticalPreset): Promise<number> {
  if (preset.tags.length === 0) return 0;
  const existing = await listTags(ctx);
  const byName = new Set(existing.map((tag) => tag.name.toLowerCase()));

  let count = 0;
  for (const name of preset.tags) {
    if (byName.has(name.toLowerCase())) continue;
    await createTag(ctx, { name });
    count += 1;
  }
  return count;
}
