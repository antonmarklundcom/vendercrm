import { Smartphone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listAccountsForTenant } from "@/modules/whatsapp/accounts";
import { listTemplates } from "@/modules/whatsapp/templates";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { bookingTemplateStatuses } from "@/modules/booking/notification-registration";
import { submitBookingTemplatesAction, syncTemplatesAction } from "./actions";
import { WhatsappConnectForm } from "./WhatsappConnectForm";

export default async function WhatsappPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.whatsapp");

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const accounts = await listAccountsForTenant(ctx);
  // The booking chain falls back to email until these are APPROVED, so the
  // page has to say where they stand rather than leave a tenant assuming
  // their customers are being told (plan-booking.md §5.1).
  const bookingTemplates = await bookingTemplateStatuses(ctx);
  const templatesByAccount = new Map(
    await Promise.all(
      accounts.map(
        async (account) => [account.id, await listTemplates(ctx, account.id)] as const,
      ),
    ),
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <PageHeader title={t("title")} description={t("intro")} />

        {accounts.length === 0 ? (
          <EmptyState
            icon={Smartphone}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            actionLabel={t("connect")}
            actionHref="#conectar-numero"
          />
        ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {accounts.map((account) => {
            const templates = templatesByAccount.get(account.id) ?? [];
            return (
              <li key={account.id} className="flex flex-col gap-2 rounded-md border px-3 py-2">
                <div>
                  <p className="font-medium">{account.displayNumber || account.phoneNumberId}</p>
                  <p className="text-muted-foreground">
                    {t(`status.${account.status}` as "status.connected")} · {account.connectedVia}
                  </p>
                </div>

                <div>
                  <p className="text-muted-foreground">
                    {t("templateCount", {
                      total: templates.length,
                      approved: templates.filter((tpl) => tpl.status === "APPROVED").length,
                    })}
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {templates.map((template) => (
                      <li key={template.id} className="rounded-full border px-2 py-0.5 text-xs">
                        {template.name} ({template.language}) · {template.status}
                      </li>
                    ))}
                  </ul>
                </div>

                <form action={syncTemplatesAction}>
                  <input type="hidden" name="accountId" value={account.id} />
                  <Button type="submit" size="sm" variant="outline">
                    {t("syncTemplates")}
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
        )}
      </section>

      {accounts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("bookingTemplatesTitle")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("bookingTemplatesHelp")}</p>
          <ul className="flex flex-wrap gap-1">
            {bookingTemplates.map((template) => (
              <li key={template.name} className="rounded-full border px-2 py-0.5 text-xs">
                {template.name} ·{" "}
                {t(`bookingTemplateStatus.${template.status}` as "bookingTemplateStatus.APPROVED")}
              </li>
            ))}
          </ul>
          <form action={submitBookingTemplatesAction}>
            <Button type="submit" size="sm" variant="outline">
              {t("submitBookingTemplates")}
            </Button>
          </form>
        </section>
      ) : null}

      <section id="conectar-numero" className="scroll-mt-6">
        <h2 className="mb-4 text-lg font-semibold">{t("connectTitle")}</h2>
        <p className="mb-4 max-w-md text-sm text-muted-foreground">{t("connectHelp")}</p>
        <WhatsappConnectForm />
      </section>
    </div>
  );
}
