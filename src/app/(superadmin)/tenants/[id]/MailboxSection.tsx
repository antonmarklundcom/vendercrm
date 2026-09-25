import { getLocale, getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { clearTenantOutboundSuspensionAction, setTenantMailboxAction } from "./actions";

// Per-domain mailbox switch (PLAN-EMAIL.md §3). The tenant toggle can be set
// before the platform is configured — it simply has no effect until the
// Cloudflare env vars exist, which the status line says out loud.

export async function MailboxSection({
  tenantId,
  enabled,
  suspendedAt,
  platformConfigured,
}: {
  tenantId: string;
  enabled: boolean;
  suspendedAt: Date | null;
  platformConfigured: boolean;
}) {
  const t = await getTranslations("superadmin.tenants.mailbox");
  const locale = await getLocale();

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="mb-1 text-lg font-semibold">{t("title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs",
            enabled ? "bg-success-surface text-success" : "bg-muted text-muted-foreground",
          )}
        >
          {enabled ? t("enabled") : t("disabled")}
        </span>
        <form action={setTenantMailboxAction}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
          <Button type="submit" size="sm" variant="outline">
            {enabled ? t("disable") : t("enable")}
          </Button>
        </form>
        {!platformConfigured && (
          <span className="text-muted-foreground">{t("platformNotConfigured")}</span>
        )}
      </div>
      {suspendedAt && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-destructive-surface px-2.5 py-1 text-xs text-destructive">
            {t("suspendedSince", { date: formatDate(suspendedAt, locale) })}
          </span>
          <form action={clearTenantOutboundSuspensionAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <Button type="submit" size="sm" variant="outline">
              {t("clearSuspension")}
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}
