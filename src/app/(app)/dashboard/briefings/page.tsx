import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listBriefings } from "@/modules/coach/briefing";
import { PageHeader } from "@/components/page-header";
import { formatDate } from "@/lib/i18n/format";

export default async function BriefingsListPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.dashboard.briefing");
  const locale = await getLocale();

  const briefings = await listBriefings(ctx);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("listTitle")} />

      {briefings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {briefings.map((briefing) => (
            <li key={briefing.id} className="rounded-md border px-3 py-2">
              <Link href={`/dashboard/briefings/${briefing.id}`} className="underline underline-offset-4">
                {formatDate(briefing.weekStart, locale, { dateStyle: "medium" })}
              </Link>
              <span className="ml-2 text-muted-foreground">
                {t(briefing.source === "ai" ? "sourceValues.ai" : "sourceValues.template")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
