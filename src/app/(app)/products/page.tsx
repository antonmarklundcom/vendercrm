import { Package } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listProducts } from "@/modules/quotes/products";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CreateDialog } from "@/components/create-dialog";
import { toggleProductAction } from "./actions";
import { ProductCreateForm } from "./ProductCreateForm";
import { formatMoney } from "@/lib/i18n/format";
import { getLocale } from "next-intl/server";

export default async function ProductsPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.products");
  const locale = await getLocale();
  const tc = await getTranslations("common");
  // Agents sell from the catalog, so they still read all of it — but creating
  // a product and taking one out of circulation are admin-only (§3.2), so
  // those controls (and bulk import, which is the same kind of write) are
  // not rendered for them. Export is read-only, so it stays available to
  // everyone who can see the catalog.
  const isAdmin = ctx.role === "admin";
  const products = await listProducts(ctx, true);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <PageHeader
          title={t("title")}
          description={t("intro")}
          action={
            <>
              <Button asChild variant="ghost">
                <a href="/api/exports/products">{t("exportCsv")}</a>
              </Button>
              {isAdmin && (
                <>
                  <Button asChild variant="ghost">
                    <Link href="/products/import">{t("importAction")}</Link>
                  </Button>
                  <CreateDialog
                    id="nuevo-producto"
                    triggerLabel={t("createTitle")}
                    title={t("createTitle")}
                    closeLabel={tc("close")}
                  >
                    <ProductCreateForm />
                  </CreateDialog>
                </>
              )}
            </>
          }
        />

        {products.length === 0 ? (
          <EmptyState
            icon={Package}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            actionLabel={isAdmin ? tc("create") : undefined}
            actionHref={isAdmin ? "#nuevo-producto" : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
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
                      {formatMoney(product.unitPrice, product.currency, locale)}
                    </td>
                    <td className="py-2 text-right">
                      {isAdmin && (
                        <form action={toggleProductAction}>
                          <input type="hidden" name="productId" value={product.id} />
                          <input
                            type="hidden"
                            name="isActive"
                            value={product.isActive ? "false" : "true"}
                          />
                          <Button type="submit" size="sm" variant="outline">
                            {product.isActive ? t("deactivate") : t("activate")}
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}
