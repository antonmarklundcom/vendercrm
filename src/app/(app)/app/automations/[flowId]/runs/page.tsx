import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getFlow } from "@/modules/automations/flows";
import { listRunsForFlow } from "@/modules/automations/engine";
import { getContact } from "@/modules/crm/contacts";
import { cancelRunAction } from "../../actions";
import { Button } from "@/components/ui/button";

const STATUS_LABEL: Record<string, string> = {
  running: "Ejecutando",
  waiting: "Esperando",
  completed: "Completado",
  failed: "Falló",
  cancelled: "Cancelado",
};

export default async function FlowRunsPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  const t = await getTranslations("app");
  const ctx = await requireTenantContext();

  const flow = await getFlow(ctx, flowId);
  if (!flow) notFound();

  const runs = await listRunsForFlow(ctx, flowId);
  const contacts = await Promise.all(runs.map((r) => getContact(ctx, r.contactId)));

  const counters = runs.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">
          {flow.name} — {t("runs")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {Object.entries(counters)
            .map(([status, count]) => `${STATUS_LABEL[status] ?? status}: ${count}`)
            .join(" · ") || "—"}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">{t("contact")}</th>
              <th className="px-4 py-2 font-medium">{t("quoteStatus")}</th>
              <th className="px-4 py-2 font-medium">Nodo actual</th>
              <th className="px-4 py-2 font-medium">Pasos</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-2">{contacts[i]?.name ?? "—"}</td>
                <td className="px-4 py-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.currentNodeId ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.stepCount}</td>
                <td className="px-4 py-2 text-right">
                  {(r.status === "running" || r.status === "waiting") && (
                    <form
                      action={async () => {
                        "use server";
                        await cancelRunAction(flowId, r.id);
                      }}
                    >
                      <Button type="submit" variant="ghost" size="sm">
                        {t("cancel")}
                      </Button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
