"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { tenants } from "@/db/schema/tenancy";
import { getTenantContext } from "./context";

export type TenantSettings = {
  businessHours?: string;
  brandColor?: string;
};

export async function updateTenantSettings(input: {
  timezone: string;
  settings: TenantSettings;
}): Promise<void> {
  const ctx = await getTenantContext();
  if (ctx.role !== "admin") {
    throw new Error("Solo un administrador puede editar la configuración del tenant");
  }

  const [current] = await db.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
  if (!current) throw new Error("Tenant not found");

  await db
    .update(tenants)
    .set({
      timezone: input.timezone,
      settings: { ...current.settings, ...input.settings },
    })
    .where(eq(tenants.id, ctx.tenantId));

  revalidatePath("/settings");
}
