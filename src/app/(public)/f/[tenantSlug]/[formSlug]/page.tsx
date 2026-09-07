import { notFound } from "next/navigation";
import Script from "next/script";
import { getPublicForm } from "@/modules/forms/submissions";
import type { FormField } from "@/modules/forms/forms";
import { getTranslator } from "@/lib/i18n/translator";
import { submitFormAction } from "./actions";
import { Input, Select, Textarea } from "@/components/ui/form-fields";

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; formSlug: string }>;
}) {
  const { tenantSlug, formSlug } = await params;
  const resolved = await getPublicForm(tenantSlug, formSlug);
  if (!resolved) notFound();

  const { tenant, form, turnstileSiteKey } = resolved;
  // The tenant whose form this is decides the language of the chrome around
  // their own field labels (PLAN.md §13 H5 #4).
  const t = await getTranslator(tenant.locale, "public.form");
  const fields = form.fields as FormField[];
  const action = submitFormAction.bind(null, tenantSlug, formSlug);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">{form.name}</h1>
      <form action={action} className="flex flex-col gap-4">
        {/* Honeypot: real users never see or fill this field. */}
        <input
          type="text"
          name="_hp"
          tabIndex={-1}
          autoComplete="off"
          className="absolute -left-[9999px]"
          aria-hidden="true"
        />
        {fields.map((field) =>
          field.type === "checkbox" ? (
            <label key={field.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={field.key} value="1" required={field.required} />
              {field.label}
            </label>
          ) : (
            <label key={field.key} className="flex flex-col gap-1 text-sm">
              {field.label}
              {field.type === "textarea" ? (
                <Textarea name={field.key} required={field.required} />
              ) : field.type === "select" ? (
                <Select name={field.key} required={field.required}>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  name={field.key}
                  required={field.required}
                  type={
                    field.type === "email"
                      ? "email"
                      : field.type === "phone"
                        ? "tel"
                        : field.type === "date"
                          ? "date"
                          : "text"
                  }
                />
              )}
            </label>
          ),
        )}
        {/* Turnstile, only when the form's linked site has it configured
            (PLAN.md §5.2). The site key is public by design — the secret
            never leaves the server. A form without it renders exactly as
            it did before, honeypot alone. */}
        {turnstileSiteKey && (
          <>
            <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
            <Script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js"
              async
              defer
              strategy="afterInteractive"
            />
          </>
        )}
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t("submit")}
        </button>
      </form>
    </main>
  );
}
