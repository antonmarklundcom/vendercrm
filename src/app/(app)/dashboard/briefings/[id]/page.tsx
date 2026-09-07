import { notFound } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getBriefing } from "@/modules/coach/briefing";
import { PageHeader } from "@/components/page-header";
import { formatDate } from "@/lib/i18n/format";

export default async function BriefingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.dashboard.briefing");
  const locale = await getLocale();

  const briefing = await getBriefing(ctx, id);
  if (!briefing) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("weekOf", { date: formatDate(briefing.weekStart, locale, { dateStyle: "medium" }) })}
        description={t(briefing.source === "ai" ? "sourceValues.ai" : "sourceValues.template")}
      />

      <p className="text-sm">{briefing.narrative}</p>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("recommendationsTitle")}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {briefing.recommendations.map((line, index) => (
            <li key={index}>• {line}</li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-muted-foreground">
        <Link href="/dashboard/briefings" className="underline underline-offset-4">
          {t("listTitle")}
        </Link>
      </p>
    </div>
  );
}
