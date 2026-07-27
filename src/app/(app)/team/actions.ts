"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { createInvitation } from "@/modules/tenancy/invitations";
import { setUserRole, setUserSites } from "@/modules/access/users";

const inviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(["admin", "agent", "client"]),
});

export async function inviteUserAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const input = inviteSchema.parse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  await createInvitation(ctx, input);
  revalidatePath("/team");
}

export async function setRoleAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const userId = z.string().min(1).parse(formData.get("userId"));
  const role = z.enum(["admin", "agent", "client"]).parse(formData.get("role"));
  await setUserRole(ctx, userId, role);
  revalidatePath("/team");
}

export async function setSitesAction(formData: FormData) {
  const ctx = await requireTenantAdmin();
  const userId = z.string().min(1).parse(formData.get("userId"));
  // Unchecked boxes simply aren't submitted, so the posted set is the new
  // complete grant list.
  const siteIds = formData.getAll("siteIds").map(String).filter(Boolean);
  await setUserSites(ctx, userId, siteIds);
  revalidatePath("/team");
}
