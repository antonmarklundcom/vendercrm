import { Button } from "@/components/ui/button";
import { createPlan } from "@/modules/billing/actions";
import { listPlans } from "@/modules/billing/queries";

export default async function PlansPage() {
  const rows = await listPlans();

  async function action(formData: FormData) {
    "use server";

    await createPlan({
      name: String(formData.get("name") ?? ""),
      durationMonths: Number(formData.get("durationMonths") ?? 0),
      price: Number(formData.get("price") ?? 0),
      currency: String(formData.get("currency") ?? "PYG"),
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Planes</h1>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Duración</th>
              <th className="px-4 py-2">Precio</th>
              <th className="px-4 py-2">Activo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-4 py-2">{p.name}</td>
                <td className="px-4 py-2">{p.durationMonths} meses</td>
                <td className="px-4 py-2">
                  {p.price} {p.currency}
                </td>
                <td className="px-4 py-2">{p.isActive ? "Sí" : "No"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Todavía no hay planes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form action={action} className="flex max-w-md flex-col gap-4">
        <h2 className="text-lg font-medium">Nuevo plan</h2>

        <label className="flex flex-col gap-1 text-sm">
          Nombre
          <input
            name="name"
            required
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Duración (meses)
          <select
            name="durationMonths"
            required
            className="rounded-md border border-input bg-background px-3 py-2"
          >
            <option value="3">3</option>
            <option value="6">6</option>
            <option value="12">12</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Precio (PYG)
          <input
            type="number"
            name="price"
            required
            min={0}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>

        <Button type="submit">Crear plan</Button>
      </form>
    </div>
  );
}
