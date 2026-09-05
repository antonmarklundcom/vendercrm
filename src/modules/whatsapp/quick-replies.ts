import { eq } from "drizzle-orm";
import { quickReplies } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// Quick replies (PLAN.md §15.5 J2, §15.8 P3): tenant-level canned responses,
// name + body with `{{contacto.nombre}}`-style variables. Managed by an
// admin; the `/` picker in the composer (inbox/[id]/ConversationView.tsx)
// reads the list and renders the variable before the text ever reaches the
// input — a send still goes through the existing sendText, window rules
// untouched.

export async function listQuickReplies(ctx: TenantContext) {
  const rows = await tenantDb(ctx).select(quickReplies);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createQuickReply(ctx: TenantContext, input: { name: string; body: string }) {
  const id = newId();
  await tenantDb(ctx).insert(quickReplies).values({ id, name: input.name, body: input.body });
  const [row] = await tenantDb(ctx).select(quickReplies, eq(quickReplies.id, id));
  return row ?? null;
}

export async function updateQuickReply(
  ctx: TenantContext,
  id: string,
  input: { name: string; body: string },
) {
  await tenantDb(ctx)
    .update(quickReplies)
    .set({ name: input.name, body: input.body })
    .where(eq(quickReplies.id, id));
}

export async function deleteQuickReply(ctx: TenantContext, id: string) {
  await tenantDb(ctx).delete(quickReplies, eq(quickReplies.id, id));
}

/** Resolves `{{contacto.nombre}}` against the contact the reply is going to.
 *  Unknown variables are left as-is rather than blanked, so a typo is
 *  visible to the rep before they hit send instead of silently vanishing. */
export function renderQuickReply(body: string, contact: { name: string }): string {
  return body.replace(/\{\{\s*contacto\.nombre\s*\}\}/gi, contact.name);
}
