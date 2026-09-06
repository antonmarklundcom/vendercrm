import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listCustomFieldDefinitions, CUSTOM_FIELD_TYPES } from "@/modules/crm/custom-fields";
import { PageHeader } from "@/components/page-header";
import { deleteCustomFieldAction } from "../actions";
import { NewCustomFieldForm } from "./NewCustomFieldForm";

// Custom field definitions admin (PLAN.md §15.8 P5), the same shape as
// /pipeline/etapas: admin-only, re-checked here rather than trusted from a
// hidden nav entry.
export default async function CustomFieldsPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.customFields");

  if (ctx.role !== "admin") {
    return <p className="text-muted-foreground">{t("adminOnly")}</p>;
  }

  const fields = await listCustomFieldDefinitions(ctx);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("title")}
        description={t("intro")}
        action={
          <Link href="/contacts" className="text-sm underline underline-offset-4">
            {t("backToContacts")}
          </Link>
        }
      />

      <NewCustomFieldForm
        typeOptions={CUSTOM_FIELD_TYPES.map((type) => ({
          value: type,
          label: t(`typeValues.${type}`),
        }))}
      />

      <ul className="flex flex-col gap-2">
        {fields.map((field) => (
          <li
            key={field.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
          >
            <span>
              <span className="font-medium">{field.label}</span>{" "}
              <span className="text-muted-foreground">
                ({field.key} · {t(`typeValues.${field.type}` as "typeValues.text")})
              </span>
            </span>
            <form action={deleteCustomFieldAction.bind(null, field.id)}>
              <button type="submit" className="text-xs text-destructive underline">
                {t("delete")}
              </button>
            </form>
          </li>
        ))}
        {fields.length === 0 && <li className="text-sm text-muted-foreground">{t("empty")}</li>}
      </ul>
    </div>
  );
}
