import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { importPdfAction, importTextAction, importUrlAction } from "./actions";

// Memory imports (K3, PLAN.md §16.3, §16.5-adjacent): paste text, upload a
// PDF, or give a URL — the review happens on /settings/negocio itself,
// which already shows unconfirmed (`ai_suggested`) facts with confirm/edit/
// delete per row (K1). This page is only the "get a source in" half.

export default async function MemoryImportPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; count?: string; error?: string }>;
}) {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.memory.importar");
  const params = await searchParams;

  if (ctx.role !== "admin") {
    const tMemory = await getTranslations("app.memory");
    return <p className="text-muted-foreground">{tMemory("adminOnly")}</p>;
  }

  const count = params.count ? Number(params.count) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("intro")} />
      <a href="/settings/negocio" className="text-sm underline">
        {t("back")}
      </a>

      {params.ok && count !== null ? (
        <p className="rounded-lg border p-4 text-sm">
          {count > 0 ? t("resultOk", { count }) : t("resultOkZero")}
        </p>
      ) : null}
      {params.error ? (
        <p className="rounded-lg border border-destructive p-4 text-sm text-destructive">
          {t(`errors.${params.error}` as Parameters<typeof t>[0])}
        </p>
      ) : null}

      <form action={importTextAction} className="flex flex-col gap-2 rounded-lg border p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("pasteLabel")}</span>
          <textarea name="text" rows={8} className="rounded-md border bg-background p-2 text-sm" />
        </label>
        <Button type="submit" size="sm" className="self-start">
          {t("pasteButton")}
        </Button>
      </form>

      <form action={importPdfAction} className="flex flex-col gap-2 rounded-lg border p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("pdfLabel")}</span>
          <input type="file" name="file" accept="application/pdf" className="text-sm" />
        </label>
        <Button type="submit" size="sm" className="self-start">
          {t("pdfButton")}
        </Button>
      </form>

      <form action={importUrlAction} className="flex flex-col gap-2 rounded-lg border p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("urlLabel")}</span>
          <input
            type="url"
            name="url"
            placeholder={t("urlPlaceholder")}
            className="rounded-md border bg-background p-2 text-sm"
          />
        </label>
        <Button type="submit" size="sm" className="self-start">
          {t("urlButton")}
        </Button>
      </form>
    </div>
  );
}
