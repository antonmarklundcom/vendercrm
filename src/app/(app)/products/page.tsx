import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listProducts } from "@/modules/quotes/products";
import { Button } from "@/components/ui/button";
import { createProductAction, toggleProductAction } from "./actions";

export default async function ProductsPage() {
  const ctx = await requireTenantContext();

  // Hiding the nav link is not access control — a client must be refused
  // here too, or the URL alone would be enough (PLAN.md §5.2).
  if (ctx.role === "client") {
    return <p className="text-muted-foreground">{(await getTranslations("app"))("clientPortalOnly")}</p>;
  }
  const t = await getTranslations("app.products");
  const tc = await getTranslations("common");
  const products = await listProducts(ctx, true);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">{t("name")}</th>
              <th className="py-2 text-right">{t("unitPrice")}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b">
                <td className="py-2">
                  {product.name}
                  {!product.isActive && (
                    <span className="ml-2 text-xs text-muted-foreground">({t("inactive")})</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {new Intl.NumberFormat("es-PY").format(product.unitPrice)} {product.currency}
                </td>
                <td className="py-2 text-right">
                  <form action={toggleProductAction}>
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="isActive" value={product.isActive ? "false" : "true"} />
                    <Button type="submit" size="sm" variant="outline">
                      {product.isActive ? t("deactivate") : t("activate")}
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("createTitle")}</h2>
        <form action={createProductAction} className="flex max-w-sm flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            {t("name")}
            <input name="name" required className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("description")}
            <textarea name="description" className="rounded-md border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("unitPrice")}
            <input name="unitPrice" type="number" min={0} step={1} required className="rounded-md border px-3 py-2" />
          </label>
          <Button type="submit">{tc("create")}</Button>
        </form>
      </section>
    </div>
  );
}
