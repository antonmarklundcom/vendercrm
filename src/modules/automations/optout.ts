import { eq } from "drizzle-orm";
import { tags, contactTags } from "@/db/schema";
import { tenantDb } from "@/modules/tenancy/db";
import type { TenantContext } from "@/modules/tenancy/types";
import { addTagToContact } from "@/modules/crm/contacts";

export const OPTOUT_TAG_NAME = "optout";

// Finds (or creates) the tenant's `optout` tag. Idempotent — safe to call
// from concurrent inbound-message handlers.
async function getOrCreateOptoutTag(ctx: TenantContext): Promise<string> {
  const tdb = tenantDb(ctx);
  const existing = await tdb.select(tags, eq(tags.name, OPTOUT_TAG_NAME));
  if (existing.length > 0) return existing[0].id;

  const { newId } = await import("@/lib/ids");
  const id = newId();
  try {
    await tdb.insert(tags, { id, name: OPTOUT_TAG_NAME, color: "#71717a" });
    return id;
  } catch {
    // Lost a race to create the tag — read the one the other caller made.
    const rows = await tdb.select(tags, eq(tags.name, OPTOUT_TAG_NAME));
    return rows[0].id;
  }
}

export async function isContactOptedOut(
  ctx: TenantContext,
  contactId: string,
): Promise<boolean> {
  const tdb = tenantDb(ctx);
  const optoutTags = await tdb.select(tags, eq(tags.name, OPTOUT_TAG_NAME));
  if (optoutTags.length === 0) return false;
  const links = await tdb.select(contactTags, eq(contactTags.contactId, contactId));
  return links.some((l) => l.tagId === optoutTags[0].id);
}

const OPTOUT_KEYWORDS = ["baja", "stop", "unsubscribe", "detener"];

// Auto-applied when an inbound message body matches an opt-out keyword
// (PLAN.md §7.2). Case/accent-insensitive, whole-message match (not
// substring) to avoid false positives on ordinary text containing "stop".
export function isOptoutMessage(body: string | null): boolean {
  if (!body) return false;
  const normalized = body
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return OPTOUT_KEYWORDS.includes(normalized);
}

export async function applyOptout(
  ctx: TenantContext,
  contactId: string,
): Promise<void> {
  const tagId = await getOrCreateOptoutTag(ctx);
  await addTagToContact(ctx, contactId, tagId);
}
