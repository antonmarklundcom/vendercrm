"use server";

import { redirect } from "next/navigation";
import { newId } from "@/lib/ids";
import { storage } from "@/lib/storage";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { importFromPdf, importFromText, importFromUrl } from "@/modules/memory/imports";

// Memory imports (K3, PLAN.md §16.5-adjacent): each action extracts, then
// redirects back to this page with the outcome in the query string — the
// page itself is a server component with no client state, same pattern as
// the setup assistant's onboarding actions (K2).

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function redirectWithResult(result: Awaited<ReturnType<typeof importFromText>>): never {
  if (result.ok) {
    redirect(`/settings/negocio/importar?ok=1&count=${result.extractedCount}`);
  }
  redirect(`/settings/negocio/importar?error=${result.reason}`);
}

export async function importTextAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantAdmin();
  const text = String(formData.get("text") ?? "").trim();
  if (!text) redirect("/settings/negocio/importar?error=empty");

  const result = await importFromText(ctx, text);
  redirectWithResult(result);
}

export async function importPdfAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect("/settings/negocio/importar?error=empty");
  if (file.size > MAX_PDF_BYTES) redirect("/settings/negocio/importar?error=extraction_failed");

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `memory-imports/${ctx.tenantId}/${newId()}.pdf`;
  await storage.put(key, buffer, "application/pdf");

  const result = await importFromPdf(ctx, key);
  redirectWithResult(result);
}

export async function importUrlAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantAdmin();
  const url = String(formData.get("url") ?? "").trim();
  if (!url) redirect("/settings/negocio/importar?error=empty");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    redirect("/settings/negocio/importar?error=fetch_failed");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    redirect("/settings/negocio/importar?error=fetch_failed");
  }

  const result = await importFromUrl(ctx, parsed.toString());
  redirectWithResult(result);
}
