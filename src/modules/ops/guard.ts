import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { opsObjects } from "@/db/schema";
import { newId } from "@/lib/ids";
import { allowedTenantIds, type OpsTokenRow } from "./tokens";

// The whole security story of §18 (PLAN.md §18.1.2, and the one thing
// `prompts/_handoff-o.md` forbids widening to make a test pass).
//
// An ops token is create-only and blind to everything that existed before
// it. That is not enforced endpoint by endpoint — it is enforced here, by a
// single question asked against `ops_objects`: did this token create the
// thing it is asking about? A pre-existing site is not in that table, so
// there is no code path on which forgetting a check exposes it.
//
// The one exception is an allowlisted tenant (§18.1.3), and it is deliberately
// narrow: it permits *creating a new site* in that tenant, and nothing else.
// The tenant's existing sites, pipelines, contacts and deals stay invisible,
// because they are not in `ops_objects` either.

export type OpsEntity =
  | "tenant"
  | "site"
  | "pipeline"
  | "api_key"
  | "user"
  | "contact"
  | "deal";

/**
 * A refusal, carrying the status the endpoint returns.
 *
 * `not_found` (404), never 403, for anything the token may not touch: a 403
 * would confirm that the id names a real object, which is precisely what a
 * token blind to pre-existing data must not reveal.
 */
export class OpsAccessError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "OpsAccessError";
  }
}

export type RegisterOpsObjectInput = {
  tokenId: string;
  batchId?: string | null;
  rowId?: string | null;
  entity: OpsEntity;
  entityId: string;
};

/** Records an object as this token's. Every create path ends in one of these. */
export async function registerOpsObject(input: RegisterOpsObjectInput): Promise<void> {
  await db.insert(opsObjects).values({
    id: newId(),
    tokenId: input.tokenId,
    batchId: input.batchId ?? null,
    rowId: input.rowId ?? null,
    entity: input.entity,
    entityId: input.entityId,
  });
}

/** Did this token create this object? The guard's only question. */
export async function mayTouch(
  token: OpsTokenRow,
  entity: OpsEntity,
  entityId: string,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(opsObjects)
    .where(
      and(
        eq(opsObjects.tokenId, token.id),
        eq(opsObjects.entity, entity),
        eq(opsObjects.entityId, entityId),
      ),
    );
  return !!row;
}

/**
 * Throwing form, used by every endpoint that names an id. The message is
 * uniform ("not found") on purpose — see OpsAccessError.
 */
export async function assertMayTouch(
  token: OpsTokenRow,
  entity: OpsEntity,
  entityId: string,
): Promise<void> {
  if (!(await mayTouch(token, entity, entityId))) {
    throw new OpsAccessError(404, `${entity} not found`);
  }
}

/**
 * Site creation is the one action an allowlisted tenant unlocks (§18.1.3):
 * either the token created the tenant, or the owner listed it explicitly.
 * Nothing else in this module accepts the allowlist as an answer.
 */
export async function mayCreateSiteInTenant(
  token: OpsTokenRow,
  tenantId: string,
): Promise<boolean> {
  if (allowedTenantIds(token).includes(tenantId)) return true;
  return mayTouch(token, "tenant", tenantId);
}

export async function assertMayCreateSiteInTenant(
  token: OpsTokenRow,
  tenantId: string,
): Promise<void> {
  if (!(await mayCreateSiteInTenant(token, tenantId))) {
    throw new OpsAccessError(404, "tenant not found");
  }
}

/** The objects one row created — what the console's row drawer lists. */
export async function listOpsObjectsForRow(rowId: string) {
  return db.select().from(opsObjects).where(eq(opsObjects.rowId, rowId));
}
