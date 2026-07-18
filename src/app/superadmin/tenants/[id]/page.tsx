import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setTenantStatus } from "@/modules/tenancy/tenant-actions";
import { startImpersonation } from "@/modules/tenancy/actions";
import { getTenantById, listTenantUsers } from "@/modules/tenancy/queries";
import { recordPayment } from "@/modules/billing/actions";
import { listActivePlans, listTenantSubscriptions } from "@/modules/billing/queries";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const tenant = await getTenantById(id);
  if (!tenant) notFound();

  const [users, tenantSubscriptions, activePlans] = await Promise.all([
    listTenantUsers(id),
    listTenantSubscriptions(id),
    listActivePlans(),
  ]);

  async function toggleStatus() {
    "use server";
    await setTenantStatus(id, tenant.status === "suspended" ? "active" : "suspended");
  }

  async function recordPaymentAction(formData: FormData) {
    "use server";
    await recordPayment({
      tenantId: id,
      planId: String(formData.get("planId") ?? ""),
      amount: Number(formData.get("amount") ?? 0),
      method: formData.get("method") as "transfer" | "cash" | "other",
      reference: String(formData.get("reference") ?? "") || undefined,
      notes: String(formData.get("notes") ?? "") || undefined,
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">{tenant.slug}</p>
        </div>
        <form action={toggleStatus}>
          <Button variant={tenant.status === "suspended" ? "default" : "destructive"}>
            {tenant.status === "suspended" ? "Reactivar" : "Suspender"}
          </Button>
        </form>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Usuarios</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Rol</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                async function impersonate() {
                  "use server";
                  await startImpersonation(u.id);
                }

                return (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-4 py-2">{u.name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-2">{u.role}</td>
                    <td className="px-4 py-2 text-right">
                      <form action={impersonate}>
                        <Button variant="outline" size="sm">
                          Impersonar
                        </Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    Sin usuarios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Suscripciones y pagos</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-4 py-2">Desde</th>
                <th className="px-4 py-2">Hasta</th>
                <th className="px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {tenantSubscriptions.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-2">{s.startsAt.toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-2">{s.expiresAt.toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-2">{s.status}</td>
                </tr>
              ))}
              {tenantSubscriptions.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                    Sin suscripciones todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form action={recordPaymentAction} className="flex max-w-md flex-col gap-3 pt-2">
          <h3 className="text-sm font-medium">Registrar pago</h3>

          <label className="flex flex-col gap-1 text-sm">
            Plan
            <select
              name="planId"
              required
              className="rounded-md border border-input bg-background px-3 py-2"
            >
              {activePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.price} {p.currency} / {p.durationMonths}m
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Monto
            <input
              type="number"
              name="amount"
              required
              min={0}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Método
            <select
              name="method"
              required
              className="rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="transfer">Transferencia</option>
              <option value="cash">Efectivo</option>
              <option value="other">Otro</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Referencia
            <input
              name="reference"
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Notas
            <textarea
              name="notes"
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>

          <Button type="submit" disabled={activePlans.length === 0}>
            Registrar pago
          </Button>
          {activePlans.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Creá un plan primero en la sección Planes.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
