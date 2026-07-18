import { notFound } from "next/navigation";
import { getPublicForm } from "@/modules/forms/public";
import { PublicFormRenderer } from "@/components/public-form-renderer";

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; formSlug: string }>;
}) {
  const { tenantSlug, formSlug } = await params;

  const resolved = await getPublicForm(tenantSlug, formSlug);
  if (!resolved) notFound();

  const { tenant, form } = resolved;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-lg border border-border p-6">
        <h1 className="mb-1 text-xl font-semibold">{form.name}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{tenant.name}</p>
        <PublicFormRenderer tenantSlug={tenantSlug} formSlug={formSlug} fields={form.fields} />
      </div>
    </div>
  );
}
