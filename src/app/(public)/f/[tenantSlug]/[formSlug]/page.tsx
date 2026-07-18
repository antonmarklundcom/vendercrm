import { notFound } from "next/navigation";
import { resolvePublicForm } from "@/modules/forms/service";
import { PublicFormClient } from "./form-client";

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; formSlug: string }>;
}) {
  const { tenantSlug, formSlug } = await params;
  const form = await resolvePublicForm(tenantSlug, formSlug);
  if (!form) notFound();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center p-6">
      <p className="mb-4 text-sm text-muted-foreground">{form.tenantName}</p>
      <PublicFormClient
        tenantSlug={tenantSlug}
        formSlug={formSlug}
        name={form.name}
        fields={form.fields}
      />
    </div>
  );
}
