import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getForm, hasFormSubmissions } from "@/modules/forms/forms";
import { listCustomFieldDefinitions } from "@/modules/crm/custom-fields";
import { PageHeader } from "@/components/page-header";
import type { FormField } from "@/modules/forms/field-definitions";
import { FieldEditor } from "./FieldEditor";

export default async function FormEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.forms");

  // Same posture as /forms itself (§3.2: a form is tenant configuration).
  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const form = await getForm(ctx, id);
  if (!form) notFound();

  const [locked, customFieldDefs] = await Promise.all([
    hasFormSubmissions(ctx, id),
    listCustomFieldDefinitions(ctx),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("editor.title", { name: form.name })} />
      {locked && <p className="text-sm text-muted-foreground">{t("editor.locked")}</p>}
      <FieldEditor
        formId={form.id}
        fields={form.fields as FormField[]}
        locked={locked}
        customFields={customFieldDefs.map((d) => ({ key: d.key, label: d.label }))}
      />
    </div>
  );
}
