import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getTenant,
  listTenantUsers,
} from "@/modules/tenancy/service";
import {
  getSubscription,
  listPayments,
  listPlans,
  effectiveSubscriptionStatus,
} from "@/modules/billing/service";
import {
  setTenantStatusAction,
  recordPaymentAction,
  impersonateAction,
} from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const t = await getTranslations("superadmin");
  const tenant = await getTenant(tenantId);
  if (!tenant) notFound();

  const [subscription, plans, users] = await Promise.all([
    getSubscription(tenantId),
    listPlans(),
    listTenantUsers({
      tenantId,
      userId: "",
      role: "admin",
      isSuperadmin: true,
      impersonatorUserId: null,
    }),
  ]);
  const payments = subscription ? await listPayments(subscription.id) : [];
  const effective = subscription
    ? effectiveSubscriptionStatus(subscription)
    : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">
            {tenant.slug} · {t(tenant.status)}
          </p>
        </div>
        <div className="flex gap-2">
          <form
            action={async () => {
              "use server";
              await setTenantStatusAction(
                tenantId,
                tenant.status === "suspended" ? "active" : "suspended",
              );
            }}
          >
            <Button type="submit" variant="outline" size="sm">
              {tenant.status === "suspended" ? t("activate") : t("suspend")}
            </Button>
          </form>
          <form
            action={async () => {
              "use server";
              await impersonateAction(tenantId);
            }}
          >
            <Button type="submit" size="sm">
              {t("impersonate")}
            </Button>
          </form>
        </div>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 font-semibold">{t("subscription")}</h2>
        {subscription ? (
          <p className="text-sm">
            {t("expiresAt")}: {subscription.expiresAt.toLocaleDateString("es-PY")} ·{" "}
            {effective && t(effective)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noSubscription")}</p>
        )}
      </section>

      <section className="max-w-md">
        <h2 className="mb-4 text-lg font-semibold">{t("recordPayment")}</h2>
        <form action={recordPaymentAction} className="flex flex-col gap-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="grid gap-1.5">
            <Label htmlFor="planId">{t("plan")}</Label>
            <select
              id="planId"
              name="planId"
              required
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {plans
                .filter((p) => p.isActive)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.durationMonths}m)
                  </option>
                ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="amount">{t("amount")} (PYG)</Label>
            <Input id="amount" name="amount" type="number" min={0} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="method">{t("method")}</Label>
            <select
              id="method"
              name="method"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="transfer">{t("transfer")}</option>
              <option value="cash">{t("cash")}</option>
              <option value="other">{t("other")}</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reference">{t("reference")}</Label>
            <Input id="reference" name="reference" />
          </div>
          <Button type="submit" className="mt-2 w-fit">
            {t("recordPayment")}
          </Button>
        </form>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("payments")}</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">{t("amount")}</th>
                <th className="px-4 py-2 font-medium">{t("method")}</th>
                <th className="px-4 py-2 font-medium">{t("reference")}</th>
                <th className="px-4 py-2 font-medium">{t("expiresAt")}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2">
                    {p.amount.toLocaleString("es-PY")} {p.currency}
                  </td>
                  <td className="px-4 py-2">{t(p.method)}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {p.reference ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {p.createdAt.toLocaleDateString("es-PY")}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    —
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("users")}</h2>
        <ul className="text-sm">
          {users.map((u) => (
            <li key={u.id} className="border-t py-2">
              {u.name} · {u.email} · {u.tenantRole}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
