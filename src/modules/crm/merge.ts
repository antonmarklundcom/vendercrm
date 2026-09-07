import { eq, getTableColumns, getTableName, is, type AnyColumn } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "@/db/schema";
import { contactTags, contacts } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantTransaction } from "@/modules/tenancy/db";
import { writeAuditLog } from "@/modules/tenancy/audit";

// Contact merge (PLAN.md §15.5 J11c, §17.2/§17.3 P16). Two contacts that are
// really one person get folded into one row, with every table that
// references the loser's id re-pointed to the winner's — derived from the
// schema itself, not a hand-typed list, because a hand-typed list is
// exactly the kind of thing a later phase forgets to update (§4 has no
// foreign keys to catch a forgotten one).

export type ContactReferenceColumn = {
  tableName: string;
  table: MySqlTable;
  column: AnyColumn;
};

/**
 * Every table in the schema carrying a `contactId` column, `contact_tags`
 * included — derived by walking the schema module rather than typed by
 * hand. `mergeContacts` treats `contact_tags` specially (a union, since it
 * has a unique index on (contact_id, tag_id) a blind re-point would
 * violate); every other table here is re-pointed with one UPDATE.
 */
export function contactReferenceColumns(): ContactReferenceColumn[] {
  const results: ContactReferenceColumn[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, MySqlTable)) continue;
    const columns = getTableColumns(value);
    for (const [key, column] of Object.entries(columns)) {
      if (key === "contactId") {
        results.push({ tableName: getTableName(value), table: value, column });
      }
    }
  }
  return results;
}

export type ContactFieldKey = "name" | "email" | "notes" | "source" | "ownerUserId" | "companyId";
export const CONTACT_FIELD_KEYS: readonly ContactFieldKey[] = [
  "name",
  "email",
  "notes",
  "source",
  "ownerUserId",
  "companyId",
];
export type FieldChoice = "winner" | "loser";
export type FieldChoices = Partial<Record<ContactFieldKey, FieldChoice>>;

/** Winner's value unless an explicit choice says otherwise, and unless the
 *  winner's is empty — the spec's default ("winner's, and the loser's only
 *  where the winner's is empty") applied per field. */
function resolveField(
  winnerValue: unknown,
  loserValue: unknown,
  choice: FieldChoice | undefined,
): unknown {
  if (choice === "loser") return loserValue;
  if (choice === "winner") return winnerValue;
  const winnerEmpty = winnerValue === null || winnerValue === undefined || winnerValue === "";
  return winnerEmpty ? loserValue : winnerValue;
}

export type MergeCountsByTable = Record<string, number>;

export type MergeResult = {
  winnerId: string;
  loserId: string;
  countsByTable: MergeCountsByTable;
  fieldChoices: FieldChoices;
};

export class MergeError extends Error {
  constructor(readonly code: "notFound" | "sameContact") {
    super(code === "sameContact" ? "cannot_merge_contact_with_itself" : "contact_not_found");
  }
}

/**
 * Re-points every derived column, unions tags and `custom`, fills the
 * winner's empty scalar fields from the loser (or takes the loser's where
 * `fieldChoices` says so), keeps the earliest `created_at` and first-touch
 * attribution, deletes the loser, and audits the whole thing — all in one
 * transaction, so a failure partway through leaves neither contact
 * half-merged. Admin-only (enforced by the caller via
 * `requireTenantAdmin()`).
 */
export async function mergeContacts(
  ctx: TenantContext,
  winnerId: string,
  loserId: string,
  fieldChoices: FieldChoices = {},
): Promise<MergeResult> {
  if (winnerId === loserId) throw new MergeError("sameContact");

  return tenantTransaction(ctx, async (tx) => {
    const [winner] = await tx.select(contacts, eq(contacts.id, winnerId));
    const [loser] = await tx.select(contacts, eq(contacts.id, loserId));
    if (!winner || !loser) throw new MergeError("notFound");

    const countsByTable: MergeCountsByTable = {};

    // contact_tags is a union, not a blind re-point: (contact_id, tag_id) is
    // unique, so a tag both contacts already carry would collide.
    const loserTags = await tx.select(contactTags, eq(contactTags.contactId, loserId));
    const winnerTagIds = new Set(
      (await tx.select(contactTags, eq(contactTags.contactId, winnerId))).map((row) => row.tagId),
    );
    let tagsMoved = 0;
    for (const tag of loserTags) {
      if (!winnerTagIds.has(tag.tagId)) {
        await tx
          .insert(contactTags)
          .values({ id: newId(), contactId: winnerId, tagId: tag.tagId });
        tagsMoved += 1;
      }
    }
    await tx.delete(contactTags, eq(contactTags.contactId, loserId));
    countsByTable[getTableName(contactTags)] = tagsMoved;

    // Every other derived column: one UPDATE each, re-pointing every row
    // the loser id still appears on.
    for (const { tableName, table, column } of contactReferenceColumns()) {
      if (table === contactTags) continue;
      const rows = await tx.select(table as never, eq(column, loserId) as never);
      if (rows.length === 0) continue;
      await tx
        .update(table as never)
        .set({ contactId: winnerId } as never)
        .where(eq(column, loserId) as never);
      countsByTable[tableName] = rows.length;
    }

    const winnerFirst = winner.createdAt <= loser.createdAt;

    const mergedCustom = {
      ...((loser.custom as Record<string, unknown>) ?? {}),
      ...((winner.custom as Record<string, unknown>) ?? {}),
    };

    await tx
      .update(contacts)
      .set({
        name: resolveField(winner.name, loser.name, fieldChoices.name) as string,
        email: resolveField(winner.email, loser.email, fieldChoices.email) as string | undefined,
        notes: resolveField(winner.notes, loser.notes, fieldChoices.notes) as string | undefined,
        source: resolveField(winner.source, loser.source, fieldChoices.source) as
          | string
          | undefined,
        ownerUserId: resolveField(
          winner.ownerUserId,
          loser.ownerUserId,
          fieldChoices.ownerUserId,
        ) as string | undefined,
        companyId: resolveField(
          winner.companyId,
          loser.companyId,
          fieldChoices.companyId,
        ) as string | undefined,
        custom: mergedCustom,
        createdAt: winnerFirst ? winner.createdAt : loser.createdAt,
        firstSiteId: winnerFirst ? winner.firstSiteId : loser.firstSiteId,
        firstTouchUtm: winnerFirst ? winner.firstTouchUtm : loser.firstTouchUtm,
      })
      .where(eq(contacts.id, winnerId));

    await tx.delete(contacts, eq(contacts.id, loserId));

    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      impersonatorUserId: ctx.impersonatorUserId,
      action: "contact.merge",
      entity: "contact",
      entityId: winnerId,
      payload: { winnerId, loserId, countsByTable, fieldChoices },
    });

    return { winnerId, loserId, countsByTable, fieldChoices };
  });
}
