"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { writeAuditLog } from "@/modules/audit/log";
import { getSuperadminContext, getTenantContext } from "./context";

export async function startImpersonation(targetUserId: string): Promise<void> {
  const superadmin = await getSuperadminContext();

  await auth.api.impersonateUser({
    body: { userId: targetUserId },
    headers: await headers(),
  });

  await writeAuditLog({
    actorUserId: superadmin.userId,
    action: "impersonation.start",
    entity: "user",
    entityId: targetUserId,
  });

  redirect("/dashboard");
}

export async function stopImpersonation(): Promise<void> {
  const ctx = await getTenantContext();

  if (!ctx.isImpersonating) {
    throw new Error("Not currently impersonating anyone");
  }

  await auth.api.stopImpersonating({ headers: await headers() });

  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.actorUserId,
    action: "impersonation.stop",
    entity: "user",
    entityId: ctx.userId,
  });

  redirect("/superadmin/tenants");
}
