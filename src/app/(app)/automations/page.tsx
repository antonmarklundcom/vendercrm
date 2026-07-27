import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listFlows } from "@/modules/automations/flows";
import { TRIGGER_TYPES } from "@/modules/automations/graph";
import { Button } from "@/components/ui/button";
import { createFlowAction } from "./actions";

export default async function AutomationsPage() {
  const ctx = await requireTenantContext();

  // Hiding the nav link is not access control — a client must be refused
  // here too, or the URL alone would be enough (PLAN.md §5.2).
  if (ctx.role === "client") {
    return <p className="text-muted-foreground">{(await getTranslations("app"))("clientPortalOnly")}</p>;
  }
  const t = await getTranslations("app.automations");
  const flows = await listFlows(ctx);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-2 text-xl font-semibold">{t("title")}</h1>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
        <ul className="flex flex-col gap-2 text-sm">
          {flows.map((flow) => (
            <li key={flow.id} className="rounded-md border px-3 py-2">
              <Link href={`/automations/${flow.id}`} className="font-medium underline">
                {flow.name}
              </Link>
              <p className="text-muted-foreground">
                {t(`triggers.${flow.triggerType}` as "triggers.form_submitted")} ·{" "}
                {t(`statusValues.${flow.status}` as "statusValues.draft")}
              </p>
            </li>
          ))}
          {flows.length === 0 && <li className="text-muted-foreground">{t("empty")}</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("createTitle")}</h2>
        <form action={createFlowAction} className="flex max-w-sm flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            {t("name")}
            <input name="name" required className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("trigger")}
            <select name="triggerType" required className="rounded-md border px-3 py-2">
              {TRIGGER_TYPES.map((trigger) => (
                <option key={trigger} value={trigger}>
                  {t(`triggers.${trigger}` as "triggers.form_submitted")}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">{t("createFlow")}</Button>
        </form>
      </section>
    </div>
  );
}
