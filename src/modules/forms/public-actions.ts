"use server";

import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";
import { submitPublicForm } from "./public";

export type PublicFormActionState = { status: "idle" | "ok" | "error"; error?: string };

export async function submitPublicFormAction(
  tenantSlug: string,
  formSlug: string,
  _prevState: PublicFormActionState,
  formData: FormData,
): Promise<PublicFormActionState> {
  const honeypot = formData.get("_hp");
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    // Silently "succeed" for bots without doing anything.
    return { status: "ok" };
  }

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (!rateLimit(`form:${tenantSlug}:${formSlug}:${ip}`, 10, 10 * 60 * 1000)) {
    return { status: "error", error: "Demasiados intentos. Probá de nuevo más tarde." };
  }

  const data: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "_hp") continue;
    data[key] = String(value);
  }

  const result = await submitPublicForm(tenantSlug, formSlug, data, {
    ipAddress: ip,
    userAgent: hdrs.get("user-agent") ?? undefined,
  });

  return result.ok ? { status: "ok" } : { status: "error", error: result.error };
}
