import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { ensureDefaultContractTemplates, listContractTemplates } from "@/modules/contracts/contracts";
import { PageHeader } from "@/components/page-header";
import { createTemplateAction, updateTemplateAction } from "../actions";
import { TemplateForm } from "./TemplateForm";

export default async function ContractTemplatesPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.contracts");

  await ensureDefaultContractTemplates(ctx);
  const templates = await listContractTemplates(ctx);

  const labels = {
    name: t("templateName"),
    body: t("templateBody"),
    bodyHint: t("templateBodyHint"),
    active: t("templateActive"),
    save: t("templateSave"),
    create: t("templateCreate"),
    errors: {
      invalid: t("errors.invalid"),
      unknownVariable: t("errors.unknownVariable"),
    },
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("templatesTitle")} description={t("templatesIntro")} />

      <div className="flex flex-col gap-6">
        {templates.map((template) => (
          <TemplateForm
            key={template.id}
            action={updateTemplateAction}
            defaults={{
              templateId: template.id,
              name: template.name,
              body: template.body,
              isActive: template.isActive,
            }}
            labels={labels}
          />
        ))}
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("templateCreate")}</h2>
        <TemplateForm action={createTemplateAction} labels={labels} />
      </section>
    </div>
  );
}
