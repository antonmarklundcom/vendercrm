import { getLocale, getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { clearTenantOutboundSuspensionAction, setTenantMailboxAction } from "./actions";
import { setTenantMailboxActiveAction } from "./mailbox-actions";
import { AddMailboxForm } from "./AddMailboxForm";

export type ConsoleMailbox = {
  id: string;
  address: string;
  displayName: string | null;
  isCatchAll: boolean;
  isActive: boolean;
};

// Per-domain mailbox switch (PLAN-EMAIL.md §3). The tenant toggle can be set
// before the platform is configured — it simply has no effect until the
// Cloudflare env vars exist, which the status line says out loud.

export async function MailboxSection({
  tenantId,
  enabled,
  suspendedAt,
  platformConfigured,
  mailboxes,
  sendStats,
}: {
  tenantId: string;
  enabled: boolean;
  suspendedAt: Date | null;
  platformConfigured: boolean;
  mailboxes: ConsoleMailbox[];
  sendStats: { sentLast24h: number; cap: number; warmingUp: boolean } | null;
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
      {sendStats && (
        <p className="text-sm text-muted-foreground">
          {t("sentLast24h", { sent: sendStats.sentLast24h, cap: sendStats.cap })}
          {sendStats.warmingUp && ` · ${t("warmingUp")}`}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t("addresses")}</h3>
        {mailboxes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noAddresses")}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {mailboxes.map((mailbox) => (
              <li key={mailbox.id} className="flex flex-wrap items-center gap-2">
                <code className={cn("font-mono", !mailbox.isActive && "text-muted-foreground line-through")}>
                  {mailbox.address}
                </code>
                {mailbox.displayName && (
                  <span className="text-muted-foreground">{mailbox.displayName}</span>
                )}
                {mailbox.isCatchAll && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t("catchAll")}</span>
                )}
                <form action={setTenantMailboxActiveAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="mailboxId" value={mailbox.id} />
                  <input type="hidden" name="active" value={mailbox.isActive ? "false" : "true"} />
                  <Button type="submit" size="sm" variant="ghost">
                    {mailbox.isActive ? t("deactivate") : t("activate")}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <AddMailboxForm
          tenantId={tenantId}
          labels={{
            address: t("address"),
            addressPlaceholder: t("addressPlaceholder"),
            displayName: t("displayName"),
            catchAll: t("catchAll"),
            catchAllHelp: t("catchAllHelp"),
            submit: t("addAddress"),
            added: t("addressAdded"),
            errors: {
              invalid_address: t("errors.invalid_address"),
              address_taken: t("errors.address_taken"),
              domain_taken: t("errors.domain_taken"),
              unknown: t("errors.unknown"),
            },
          }}
        />
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
