"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { submitPublicForm } from "@/modules/forms/service";
import { rateLimit } from "@/lib/ratelimit";

export type SubmitState = { status: "idle" | "ok" | "error"; message?: string };

export async function submitFormAction(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const tenantSlug = String(formData.get("__tenant") ?? "");
  const formSlug = String(formData.get("__form") ?? "");

  // Honeypot: bots fill hidden fields. Pretend success, drop silently.
  if (formData.get("__hp")) return { status: "ok" };

  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = rateLimit(`form:${tenantSlug}/${formSlug}:${ip}`, 5, 60_000);
  if (!limited.ok) {
    return { status: "error", message: "Demasiados intentos. Probá más tarde." };
  }

  const data: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("__")) continue;
    if (typeof value === "string") data[key] = value;
  }

  const result = await submitPublicForm({
    tenantSlug,
    formSlug,
    data,
    ipAddress: ip,
    userAgent: hdrs.get("user-agent") ?? undefined,
  });

  if (!result.ok) {
    return { status: "error", message: "No se pudo enviar el formulario." };
  }
  if (result.redirectUrl) redirect(result.redirectUrl);
  return { status: "ok" };
}
