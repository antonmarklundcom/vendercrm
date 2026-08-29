import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/config/env";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { listTenantUsers } from "@/modules/tenancy/users";
import { listPipelines, listStagesForPipeline } from "@/modules/crm/pipelines";
import { listTags } from "@/modules/crm/contacts";
import { listSites } from "@/modules/sites/sites";
import { siteSettings } from "@/modules/sites/settings";
import { getBookingType, resolveBookingTypeSettings } from "@/modules/booking/types";
import { listResources, listResourcesForType } from "@/modules/booking/resources";
import { listServicesForType } from "@/modules/booking/services";
import { formatMoney } from "@/lib/i18n/format";
import { PageHeader } from "@/components/page-header";
import { TypeResourcesPicker } from "../BookingForms";
import { BookingTypeForm, type Question } from "./BookingTypeForm";
import { ServicesEditor } from "./ServicesEditor";

// One booking type, in full (docs/SPEC-BOOKING.md §2). The list page creates
// a type with the three fields it takes to publish a page; every other column
// the schema and the slot generator already read — buffers, notice, advance
// horizon, increment, assignment, location, routing, questions, Turnstile,
// reminder and cancellation cutoff — is configured here rather than being
// stuck on its default with no way to change it.

export default async function BookingTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.booking");

  // Booking configuration is tenant configuration (§3.2), the same guard the
  // list page and every action behind this form carry.
  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const type = await getBookingType(ctx, id);
  if (!type) notFound();

  const [tenant, pipelines, users, tags, sites, resources, chosenResources] = await Promise.all([
    getTenant(ctx.tenantId),
    listPipelines(ctx),
    listTenantUsers(ctx),
    listTags(ctx),
    listSites(ctx),
    listResources(ctx),
    listResourcesForType(ctx, type.id),
  ]);

  const services = await listServicesForType(ctx, type.id);

  const stageLists = await Promise.all(
    pipelines.map(
      async (pipeline) => [pipeline.id, await listStagesForPipeline(ctx, pipeline.id)] as const,
    ),
  );
  const stagesByPipeline = Object.fromEntries(
    stageLists.map(([pipelineId, stages]) => [
      pipelineId,
      stages.map((stage) => ({ id: stage.id, name: stage.name })),
    ]),
  );

  // Only a site with Turnstile credentials saved can lend them to a booking
  // page (§5.2.1) — offering the rest would produce a page that silently
  // never challenges.
  const turnstileSites = sites
    .filter((site) => !!siteSettings(site).turnstile)
    .map((site) => ({ id: site.id, name: site.name }));

  const settings = resolveBookingTypeSettings(type.settings as never);
  const publicUrl = `${env.APP_URL}/b/${tenant?.slug}/${type.slug}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={type.name} description={t("detail.intro")} />

      <div className="flex flex-col gap-2 text-sm">
        <Link href="/booking" className="text-muted-foreground underline">
          {t("detail.back")}
        </Link>
        <a className="underline" href={publicUrl}>
          {publicUrl}
        </a>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("resourcesTitle")}</h2>
        <TypeResourcesPicker
          bookingTypeId={type.id}
          resources={resources.map((resource) => ({ id: resource.id, name: resource.name }))}
          selected={chosenResources.map((resource) => resource.id)}
          label={t("resourcesTitle")}
        />
      </section>

      <BookingTypeForm
        bookingTypeId={type.id}
        pipelines={pipelines.map((pipeline) => ({ id: pipeline.id, name: pipeline.name }))}
        stagesByPipeline={stagesByPipeline}
        users={users.map((user) => ({ id: user.id, name: user.name || user.email }))}
        tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
        turnstileSites={turnstileSites}
        values={{
          name: type.name,
          slug: type.slug,
          description: type.description ?? "",
          isActive: type.isActive,
          color: type.color ?? "",
          durationMinutes: type.durationMinutes,
          bufferBeforeMinutes: type.bufferBeforeMinutes,
          bufferAfterMinutes: type.bufferAfterMinutes,
          slotIncrementMinutes: type.slotIncrementMinutes,
          minNoticeMinutes: type.minNoticeMinutes,
          maxAdvanceDays: type.maxAdvanceDays,
          maxPerDay: type.maxPerDay,
          assignment: type.assignment,
          locationMode: type.locationMode,
          locationDetail: type.locationDetail ?? "",
          createDeal: type.createDeal,
          defaultPipelineId: type.defaultPipelineId ?? "",
          defaultStageId: type.defaultStageId ?? "",
          defaultOwnerUserId: type.defaultOwnerUserId ?? "",
          defaultTagIds: (type.defaultTagIds as string[] | null) ?? [],
          turnstileSiteId: settings.turnstileSiteId ?? "",
          requireTurnstile: settings.requireTurnstile,
          // Resolved, not raw: a row written before a field existed shows the
          // default the booking engine actually applies to it today.
          reminderMinutes: settings.reminderMinutes ?? 0,
          cancellationCutoffMinutes: settings.cancellationCutoffMinutes,
          capacity: type.capacity,
          depositAmount: type.depositAmount,
          allowMultiService: type.allowMultiService,
          depositExpiryMinutes: settings.depositExpiryMinutes,
          confirmationMessage: settings.confirmationMessage ?? "",
          questions: ((type.questions as Question[] | null) ?? []).map((question) => ({
            ...question,
            options: question.options ?? [],
          })),
        }}
      />

      <ServicesEditor
        bookingTypeId={type.id}
        services={services}
        allowMultiService={type.allowMultiService}
        formatPrice={(value) => formatMoney(value, type.depositCurrency, tenant?.locale ?? "es")}
        labels={{
          title: t("servicesTitle"),
          help: t("servicesHelp"),
          empty: t("servicesEmpty"),
          name: t("serviceName"),
          extraDuration: t("serviceExtraDuration"),
          extraPrice: t("serviceExtraPrice"),
          add: t("serviceAdd"),
          remove: t("serviceRemove"),
          active: t("active"),
          inactive: t("inactive"),
          disabledHint: t("servicesDisabledHint"),
        }}
      />
    </div>
  );
}
