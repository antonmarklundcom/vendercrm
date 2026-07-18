import Link from "next/link";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/modules/tenancy/context";
import { getMyTenant } from "@/modules/tenancy/queries";
import { stopImpersonation } from "@/modules/tenancy/actions";
import { computeAccessState, getLatestSubscriptionForTenant } from "@/modules/billing/access";
import { Button } from "@/components/ui/button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;

  try {
    ctx = await getTenantContext();
  } catch {
    redirect("/login");
  }

  const tenant = await getMyTenant(ctx);
  if (!tenant) redirect("/login");

  const subscription = await getLatestSubscriptionForTenant(ctx.tenantId);
  const accessState = computeAccessState(tenant.status, subscription);

  if (accessState === "locked") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">Cuenta suspendida</h1>
        <p className="max-w-md text-muted-foreground">
          El acceso de {tenant.name} está bloqueado. Contactá a tu proveedor para
          reactivar la cuenta.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {accessState === "grace" && (
        <div className="bg-amber-500/20 px-6 py-2 text-center text-sm">
          Tu suscripción venció. La cuenta es de solo lectura hasta que se registre un
          nuevo pago.
        </div>
      )}
      {ctx.isImpersonating && (
        <div className="flex items-center justify-between bg-blue-500/20 px-6 py-2 text-sm">
          <span>Estás viendo esta cuenta como impersonación de un superadmin.</span>
          <form action={stopImpersonation}>
            <Button type="submit" variant="outline" size="sm">
              Dejar de impersonar
            </Button>
          </form>
        </div>
      )}
      <header className="flex items-center gap-6 border-b border-border px-6 py-4">
        <span className="font-semibold">VenderCRM</span>
        <nav className="flex gap-4 text-sm">
          <Link href="/dashboard" className="hover:underline">
            Inicio
          </Link>
          <Link href="/contacts" className="hover:underline">
            Contactos
          </Link>
          <Link href="/pipeline" className="hover:underline">
            Pipeline
          </Link>
          <Link href="/inbox" className="hover:underline">
            WhatsApp
          </Link>
          <Link href="/forms" className="hover:underline">
            Formularios
          </Link>
          <Link href="/settings" className="hover:underline">
            Configuración
          </Link>
        </nav>
      </header>
      <main className="flex flex-1 flex-col p-6">{children}</main>
    </div>
  );
}
