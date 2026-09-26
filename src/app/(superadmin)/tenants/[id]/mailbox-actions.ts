"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { buildSystemTenantContext, requireSuperadminContext } from "@/modules/tenancy/context";
import { writeAuditLog } from "@/modules/tenancy/audit";
import { createMailbox, deactivateMailbox, MailboxError, updateMailbox } from "@/modules/mailbox/mailboxes";

// Mailbox addresses for a business (PLAN-EMAIL.md E3). Operator-managed, like
// the business's sites: the superadmin knows which domain has been moved to
// Cloudflare. Run in the business's system context and audited.

export type AddMailboxState = { error: string | null; added: string | null };

const addSchema = z.object({
  tenantId: z.string().min(1).max(26),
  address: z.string().trim().min(3).max(320),
  displayName: z.string().trim().max(200).optional(),
  isCatchAll: z.boolean(),
});

export async function addTenantMailboxAction(
  _prev: AddMailboxState,
  formData: FormData,
): Promise<AddMailboxState> {
  const superadmin = await requireSuperadminContext();
  const parsed = addSchema.safeParse({
    tenantId: formData.get("tenantId"),
    address: formData.get("address"),
    displayName: formData.get("displayName") || undefined,
    isCatchAll: formData.get("isCatchAll") === "on",
  });
  if (!parsed.success) return { error: "invalid_address", added: null };

  const ctx = await buildSystemTenantContext(parsed.data.tenantId);
  if (!ctx) return { error: "unknown", added: null };

  let mailbox;
  try {
    mailbox = await createMailbox(ctx, parsed.data);
  } catch (err) {
    if (err instanceof MailboxError) return { error: err.code, added: null };
    return { error: "unknown", added: null };
  }

  await writeAuditLog({
    tenantId: parsed.data.tenantId,
    actorUserId: superadmin.userId,
    action: "mailbox.address_added",
    entity: "mailbox",
    entityId: mailbox!.id,
    payload: { address: mailbox!.address, isCatchAll: mailbox!.isCatchAll },
  });
  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  return { error: null, added: mailbox!.address };
}

const toggleSchema = z.object({
  tenantId: z.string().min(1).max(26),
  mailboxId: z.string().min(1).max(26),
  active: z.enum(["true", "false"]),
});

export async function setTenantMailboxActiveAction(formData: FormData) {
  const superadmin = await requireSuperadminContext();
  const parsed = toggleSchema.safeParse({
    tenantId: formData.get("tenantId"),
    mailboxId: formData.get("mailboxId"),
    active: formData.get("active"),
  });
  if (!parsed.success) return;
  const ctx = await buildSystemTenantContext(parsed.data.tenantId);
  if (!ctx) return;

  const active = parsed.data.active === "true";
  if (active) await updateMailbox(ctx, parsed.data.mailboxId, { isActive: true });
  else await deactivateMailbox(ctx, parsed.data.mailboxId);

  await writeAuditLog({
    tenantId: parsed.data.tenantId,
    actorUserId: superadmin.userId,
    action: active ? "mailbox.address_activated" : "mailbox.address_deactivated",
    entity: "mailbox",
    entityId: parsed.data.mailboxId,
  });
  revalidatePath(`/tenants/${parsed.data.tenantId}`);
}
