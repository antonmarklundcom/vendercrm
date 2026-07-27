import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listAccountsForTenant } from "@/modules/whatsapp/accounts";
import { listTemplates } from "@/modules/whatsapp/templates";
import { Button } from "@/components/ui/button";
import { connectAccountAction, syncTemplatesAction } from "./actions";

export default async function WhatsappPage() {
  const ctx = await requireTenantContext();

  // Hiding the nav link is not access control — a client must be refused
  // here too, or the URL alone would be enough (PLAN.md §5.2).
  if (ctx.role === "client") {
    return <p className="text-muted-foreground">{(await getTranslations("app"))("clientPortalOnly")}</p>;
  }
  const t = await getTranslations("app.whatsapp");

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const accounts = await listAccountsForTenant(ctx);
  const templatesByAccount = new Map(
    await Promise.all(
      accounts.map(
        async (account) => [account.id, await listTemplates(ctx, account.id)] as const,
      ),
    ),
  );

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
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
          {accounts.length === 0 && <li className="text-muted-foreground">{t("empty")}</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("connectTitle")}</h2>
        <p className="mb-4 max-w-md text-sm text-muted-foreground">{t("connectHelp")}</p>
        <form action={connectAccountAction} className="flex max-w-sm flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            {t("wabaId")}
            <input name="wabaId" required className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("phoneNumberId")}
            <input name="phoneNumberId" required className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("displayNumber")}
            <input name="displayNumber" className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("accessToken")}
            <input name="accessToken" type="password" required className="rounded-md border px-3 py-2" />
          </label>
          <Button type="submit">{t("connect")}</Button>
        </form>
      </section>
    </div>
  );
}
