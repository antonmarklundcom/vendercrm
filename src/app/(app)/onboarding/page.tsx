import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { VERTICAL_PRESETS } from "@/modules/tenancy/verticals";
import { listBookingTypes } from "@/modules/booking/types";
import { env } from "@/lib/config/env";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { applyVerticalAction } from "./actions";

// Pick a rubro, see what it will create, apply it (plan-booking.md §6.1).
//
// One screen rather than a multi-step wizard: there is exactly one decision
// to make, and a stepper around a single radio group is ceremony. The preview
// is the important part — an admin should know what is about to appear in
// their account before it does.

export default async function OnboardingPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.onboarding");

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const [tenant, types] = await Promise.all([getTenant(ctx.tenantId), listBookingTypes(ctx)]);
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  const applied = VERTICAL_PRESETS.find((preset) => preset.slug === settings.vertical);
  const firstType = types.find((type) => type.isActive);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("title")} description={t("intro")} />

      {applied ? (
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <p className="text-sm font-medium">{t("alreadyApplied", { name: applied.name })}</p>
          <p className="text-sm text-muted-foreground">{t("alreadyAppliedHelp")}</p>
          {firstType && tenant ? (
            <a className="text-sm underline" href={`${env.APP_URL}/b/${tenant.slug}/${firstType.slug}`}>
              {`${env.APP_URL}/b/${tenant.slug}/${firstType.slug}`}
            </a>
          ) : null}
        </section>
      ) : null}

      <ul className="grid gap-4 md:grid-cols-2">
        {VERTICAL_PRESETS.map((preset) => (
          <li key={preset.slug} className="flex flex-col gap-3 rounded-lg border p-4">
            <div>
              <p className="font-medium">{preset.name}</p>
              <p className="text-sm text-muted-foreground">{preset.description}</p>
            </div>

            {/* The preview. Everything below is what applying will add — and
                nothing it will remove, because applying never removes. */}
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{t("previewServices")}</dt>
                <dd>
                  {preset.bookingTypes
                    .map((type) =>
                      type.capacity && type.capacity > 1
                        ? `${type.name} (${t("previewCapacity", { count: type.capacity })})`
                        : `${type.name} · ${type.durationMinutes} min`,
                    )
                    .join(" · ")}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{t("previewResources")}</dt>
                <dd>{preset.resources.join(", ")}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{t("previewStages")}</dt>
                <dd>{preset.pipelineStages.join(" → ")}</dd>
              </div>
              {preset.flows.length > 0 && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t("previewFlows")}</dt>
                  <dd>{preset.flows.map((flow) => flow.name).join(" · ")}</dd>
                </div>
              )}
            </dl>

            <form action={applyVerticalAction}>
              <input type="hidden" name="vertical" value={preset.slug} />
              <Button type="submit" size="sm" variant={applied ? "outline" : "default"}>
                {t("apply")}
              </Button>
            </form>
          </li>
        ))}
      </ul>

      <p className="text-sm text-muted-foreground">{t("additiveNote")}</p>
    </div>
  );
}
