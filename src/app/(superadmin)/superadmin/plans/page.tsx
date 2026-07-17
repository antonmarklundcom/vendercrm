import { getTranslations } from "next-intl/server";
import { listPlans } from "@/modules/billing/service";
import { createPlanAction, setPlanActiveAction } from "../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function PlansPage() {
  const t = await getTranslations("superadmin");
  const tc = await getTranslations("common");
  const plans = await listPlans();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("plans")}</h1>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">{t("planName")}</th>
                <th className="px-4 py-2 font-medium">{t("durationMonths")}</th>
                <th className="px-4 py-2 font-medium">{t("price")}</th>
                <th className="px-4 py-2 font-medium">{t("status")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{plan.name}</td>
                  <td className="px-4 py-2">{plan.durationMonths}</td>
                  <td className="px-4 py-2">
                    {plan.price.toLocaleString("es-PY")} {plan.currency}
                  </td>
                  <td className="px-4 py-2">
                    {plan.isActive ? t("active") : t("suspended")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <form
                      action={async () => {
                        "use server";
                        await setPlanActiveAction(plan.id, !plan.isActive);
                      }}
                    >
                      <Button type="submit" variant="ghost" size="sm">
                        {plan.isActive ? t("suspend") : t("activate")}
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
              {plans.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    —
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-md">
        <h2 className="mb-4 text-lg font-semibold">{t("newPlan")}</h2>
        <form action={createPlanAction} className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="name">{t("planName")}</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="durationMonths">{t("durationMonths")}</Label>
            <Input
              id="durationMonths"
              name="durationMonths"
              type="number"
              min={1}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="price">{t("price")} (PYG)</Label>
            <Input id="price" name="price" type="number" min={0} required />
          </div>
          <Button type="submit" className="mt-2 w-fit">
            {tc("create")}
          </Button>
        </form>
      </section>
    </div>
  );
}
