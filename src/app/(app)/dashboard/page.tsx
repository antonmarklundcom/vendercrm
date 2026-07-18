import { getTenantContext } from "@/modules/tenancy/context";
import { getMyTenant } from "@/modules/tenancy/queries";

export default async function DashboardPage() {
  const ctx = await getTenantContext();
  const tenant = await getMyTenant(ctx);

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{tenant?.name}</h1>
      <p className="text-muted-foreground">
        Conectado como {ctx.role}
        {ctx.isImpersonating ? " (impersonado)" : ""}.
      </p>
    </div>
  );
}
