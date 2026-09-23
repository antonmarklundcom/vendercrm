import Link from "next/link";
import { Workflow } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listFlows } from "@/modules/automations/flows";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CreateDialog } from "@/components/create-dialog";
import { FlowCreateForm } from "./FlowCreateForm";

export default async function AutomationsPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.automations");
  const tc = await getTranslations("common");

  // Same guard the actions enforce (§3.2) — rendered here so an agent who
  // knows the URL gets a sentence instead of a page of buttons that throw.
  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const flows = await listFlows(ctx);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <PageHeader
          title={t("title")}
          description={t("intro")}
          action={
            <CreateDialog
              id="nuevo-flujo"
              triggerLabel={t("createTitle")}
              title={t("createTitle")}
              closeLabel={tc("close")}
            >
              {/* Redirects to the new flow's editor, which closes this. */}
              <FlowCreateForm />
            </CreateDialog>
          }
        />

        {flows.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            actionLabel={t("createFlow")}
            actionHref="#nuevo-flujo"
          />
        ) : (
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
          </ul>
        )}
      </section>
    </div>
  );
}
