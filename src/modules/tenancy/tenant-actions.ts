"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { tenants } from "@/db/schema/tenancy";
import { pipelines, stages } from "@/db/schema/crm";
import { DEFAULT_PIPELINE_NAME, DEFAULT_STAGES } from "@/modules/crm/pipeline-defaults";
import { auth } from "@/lib/auth";
import { writeAuditLog } from "@/modules/audit/log";
import { slugify } from "@/lib/slug";
import { getSuperadminContext } from "./context";

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name, "tenant");
  let slug = base;
  let suffix = 1;

  while (true) {
    const [existing] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (!existing) return slug;
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
}

export async function createTenant(input: {
  name: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}): Promise<void> {
  const superadmin = await getSuperadminContext();

  const slug = await uniqueSlug(input.name);
  const [inserted] = await db.insert(tenants).values({ name: input.name, slug }).$returningId();

  const [pipeline] = await db
    .insert(pipelines)
    .values({ tenantId: inserted.id, name: DEFAULT_PIPELINE_NAME, position: 0 })
    .$returningId();

  for (const stage of DEFAULT_STAGES) {
    await db.insert(stages).values({ ...stage, tenantId: inserted.id, pipelineId: pipeline.id });
  }

  const created = await auth.api.createUser({
    body: {
      email: input.adminEmail,
      password: input.adminPassword,
      name: input.adminName,
      role: "admin",
      data: { tenantId: inserted.id },
    },
  });

  await writeAuditLog({
    tenantId: inserted.id,
    actorUserId: superadmin.userId,
    action: "tenant.create",
    entity: "tenant",
    entityId: inserted.id,
    payload: { name: input.name, adminUserId: created.user.id },
  });

  redirect(`/superadmin/tenants/${inserted.id}`);
}

export async function setTenantStatus(
  tenantId: string,
  status: "active" | "suspended",
): Promise<void> {
  const superadmin = await getSuperadminContext();

  await db.update(tenants).set({ status }).where(eq(tenants.id, tenantId));

  await writeAuditLog({
    tenantId,
    actorUserId: superadmin.userId,
    action: status === "suspended" ? "tenant.suspend" : "tenant.reactivate",
    entity: "tenant",
    entityId: tenantId,
  });

  revalidatePath(`/superadmin/tenants/${tenantId}`);
}
