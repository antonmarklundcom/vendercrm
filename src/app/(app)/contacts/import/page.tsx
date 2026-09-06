import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listTags } from "@/modules/crm/contacts";
import { listCustomFieldDefinitions } from "@/modules/crm/custom-fields";
import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "./ImportWizard";

// Contact CSV import (PLAN.md §13 H6) — the migration path off GoHighLevel.
// Agent-accessible: importing a list is sales work, not tenant configuration.
export default async function ImportContactsPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.contacts.import");
  const [tags, customFields] = await Promise.all([
    listTags(ctx),
    listCustomFieldDefinitions(ctx),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("intro")} />
      <ImportWizard
        tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
        customFields={customFields.map((field) => ({ key: field.key, label: field.label }))}
      />
    </div>
  );
}
