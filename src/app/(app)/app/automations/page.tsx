import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listFlows } from "@/modules/automations/flows";
import { createFlowAction, setFlowStatusAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function AutomationsPage() {
  const t = await getTranslations("app");
  const tc = await getTranslations("common");
  const ctx = await requireTenantContext();
  const flows = await listFlows(ctx);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("automations")}</h1>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">{tc("name")}</th>
                <th className="px-4 py-2 font-medium">{t("quoteStatus")}</th>
                <th className="px-4 py-2 font-medium">{t("automationTrigger")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.id} className="border-t">
                  <td className="px-4 py-2">
                    <Link href={`/app/automations/${f.id}`} className="font-medium hover:underline">
                      {f.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{f.status}</td>
                  <td className="px-4 py-2 text-muted-foreground">{f.triggerType}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/app/automations/${f.id}/runs`}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        {t("runs")}
                      </Link>
                      {f.status !== "draft" && (
                        <form
                          action={async () => {
                            "use server";
                            await setFlowStatusAction(
                              f.id,
                              f.status === "active" ? "paused" : "active",
                            );
                          }}
                        >
                          <Button type="submit" variant="ghost" size="sm">
                            {f.status === "active" ? t("pause") : t("activate")}
                          </Button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {flows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    {t("noAutomations")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-md">
        <h2 className="mb-4 text-lg font-semibold">{t("newAutomation")}</h2>
        <form action={createFlowAction} className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="name">{tc("name")}</Label>
            <Input id="name" name="name" required />
          </div>
          <Button type="submit" className="mt-2 w-fit">
            {tc("create")}
          </Button>
        </form>
      </section>
    </div>
  );
}
