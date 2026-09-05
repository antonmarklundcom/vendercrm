import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import type { TenantSettings } from "@/modules/tenancy/settings";
import { FACT_KINDS, listFacts, type FactKind } from "@/modules/memory/facts";
import { completedPct, getProfile, memoryChecklist } from "@/modules/memory/profile";
import { FactsSection, ProfileForm, type ProfileValues } from "./BusinessMemoryForms";

// Memoria del negocio (PLAN.md §16.1). Everything the assistant is allowed
// to say, on one page, editable by the admin who is responsible for it —
// and a checklist, because "the AI answers badly" is almost always "nobody
// ever wrote down the cancellation policy".

export default async function BusinessMemoryPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.memory");

  if (ctx.role !== "admin") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title={t("title")} description={t("intro")} />
        <p className="text-sm text-muted-foreground">{t("adminOnly")}</p>
      </div>
    );
  }

  const [tenant, profile, facts] = await Promise.all([
    getTenant(ctx.tenantId),
    getProfile(ctx),
    listFacts(ctx, {}),
  ]);

  const settings = (tenant?.settings ?? {}) as TenantSettings;
  const hasBusinessHours =
    !!settings.businessHours && Object.values(settings.businessHours).some((day) => day !== null);
  const checklist = memoryChecklist({ profile, facts, hasBusinessHours });
  const pct = completedPct({ profile, facts, hasBusinessHours });

  const values: ProfileValues = {
    displayName: profile?.displayName ?? settings.ai?.businessName ?? tenant?.name ?? "",
    legalName: profile?.legalName ?? "",
    ruc: profile?.ruc ?? "",
    about: profile?.about ?? settings.ai?.about ?? "",
    audience: profile?.audience ?? "",
    differentiators: profile?.differentiators ?? "",
    tone: profile?.tone ?? "",
    toneNote: profile?.toneNote ?? settings.ai?.tone ?? "",
    website: profile?.website ?? "",
    address: profile?.address ?? "",
    mapsUrl: profile?.mapsUrl ?? "",
    neverPromise: profile?.neverPromise ?? settings.ai?.neverPromise ?? "",
    paymentMethods: (profile?.paymentMethods ?? []).join(", "),
  };

  const byKind = new Map<FactKind, typeof facts>();
  for (const kind of FACT_KINDS) byKind.set(kind, []);
  for (const fact of facts) byKind.get(fact.kind as FactKind)?.push(fact);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("title")} description={t("intro")} />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("completionTitle", { pct })}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {checklist.map((row) => (
            <li key={row.key} className="flex items-center gap-2">
              <span aria-hidden>{row.done ? "✓" : "•"}</span>
              <span className={row.done ? "text-muted-foreground" : undefined}>
                {t(`checklist.${row.key}` as "checklist.hours")}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("profileTitle")}</h2>
        <ProfileForm profile={values} />
      </section>

      {FACT_KINDS.map((kind) => (
        <FactsSection key={kind} kind={kind} facts={byKind.get(kind) ?? []} />
      ))}
    </div>
  );
}
