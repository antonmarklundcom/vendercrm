import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listProducts } from "@/modules/quotes/products";
import { createProductAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function ProductsPage() {
  const t = await getTranslations("app");
  const tc = await getTranslations("common");
  const ctx = await requireTenantContext();
  const products = await listProducts(ctx);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("products")}</h1>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">{tc("name")}</th>
                <th className="px-4 py-2 font-medium">{t("unitPrice")}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2">
                    {p.unitPrice.toLocaleString("es-PY")} {p.currency}
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
                    —
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-md">
        <h2 className="mb-4 text-lg font-semibold">{t("newProduct")}</h2>
        <form action={createProductAction} className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="name">{tc("name")}</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="unitPrice">{t("unitPrice")} (PYG)</Label>
            <Input id="unitPrice" name="unitPrice" type="number" min={0} required />
          </div>
          <Button type="submit" className="mt-2 w-fit">
            {tc("create")}
          </Button>
        </form>
      </section>
    </div>
  );
}
