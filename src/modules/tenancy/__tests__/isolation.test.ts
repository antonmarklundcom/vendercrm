import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { invitations, tenants } from "@/db/schema";
import { generateId } from "@/lib/ids";
import { tenantDb } from "../db";
import type { TenantContext } from "../context";

function makeCtx(tenantId: string): TenantContext {
  return {
    tenantId,
    userId: "test-user",
    role: "admin",
    isImpersonating: false,
    actorUserId: "test-user",
  };
}

describe("cross-tenant isolation", () => {
  let tenantAId: string;
  let tenantBId: string;
  let invitationAId: string;
  let invitationBId: string;

  beforeAll(async () => {
    tenantAId = generateId();
    tenantBId = generateId();

    await db.insert(tenants).values([
      { id: tenantAId, name: "Tenant A", slug: `tenant-a-${tenantAId}` },
      { id: tenantBId, name: "Tenant B", slug: `tenant-b-${tenantBId}` },
    ]);

    const ctxA = makeCtx(tenantAId);
    const ctxB = makeCtx(tenantBId);

    const [insertedA] = await tenantDb(ctxA).insert(invitations, {
      email: "agent-a@example.com",
      token: `token-a-${generateId()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    }).$returningId();
    invitationAId = insertedA.id;

    const [insertedB] = await tenantDb(ctxB).insert(invitations, {
      email: "agent-b@example.com",
      token: `token-b-${generateId()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    }).$returningId();
    invitationBId = insertedB.id;
  });

  afterAll(async () => {
    // Cascades to invitations via the tenants FK.
    await db.delete(tenants).where(eq(tenants.id, tenantAId));
    await db.delete(tenants).where(eq(tenants.id, tenantBId));
  });

  it("stamps the tenantId from ctx on insert, ignoring any smuggled value", async () => {
    const ctxA = makeCtx(tenantAId);

    const [row] = await db.select().from(invitations).where(eq(invitations.id, invitationAId));
    expect(row.tenantId).toBe(tenantAId);

    // Attempt to smuggle a different tenantId through the values object.
    const [smuggled] = await tenantDb(ctxA)
      .insert(invitations, {
        email: "smuggled@example.com",
        token: `token-smuggled-${generateId()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        tenantId: tenantBId,
      } as never)
      .$returningId();

    const [smuggledRow] = await db.select().from(invitations).where(eq(invitations.id, smuggled.id));
    expect(smuggledRow.tenantId).toBe(tenantAId);
  });

  it("findMany only returns rows belonging to ctx's tenant", async () => {
    const rowsA = await tenantDb(makeCtx(tenantAId)).findMany(invitations);
    const rowsB = await tenantDb(makeCtx(tenantBId)).findMany(invitations);

    expect(rowsA.every((r) => r.tenantId === tenantAId)).toBe(true);
    expect(rowsA.some((r) => r.id === invitationBId)).toBe(false);

    expect(rowsB.every((r) => r.tenantId === tenantBId)).toBe(true);
    expect(rowsB.some((r) => r.id === invitationAId)).toBe(false);
  });

  it("findFirst cannot read another tenant's row even by exact id", async () => {
    const result = await tenantDb(makeCtx(tenantAId)).findFirst(
      invitations,
      eq(invitations.id, invitationBId),
    );

    expect(result).toBeNull();
  });

  it("update cannot mutate another tenant's row even by exact id", async () => {
    await tenantDb(makeCtx(tenantAId)).update(
      invitations,
      { email: "hijacked@example.com" },
      eq(invitations.id, invitationBId),
    );

    const [stillIntact] = await db.select().from(invitations).where(eq(invitations.id, invitationBId));
    expect(stillIntact.email).toBe("agent-b@example.com");
  });

  it("delete cannot remove another tenant's row even by exact id", async () => {
    await tenantDb(makeCtx(tenantAId)).delete(invitations, eq(invitations.id, invitationBId));

    const [stillThere] = await db.select().from(invitations).where(eq(invitations.id, invitationBId));
    expect(stillThere).toBeDefined();
    expect(stillThere.id).toBe(invitationBId);
  });

  it("update/delete on ctx's own tenant row works normally", async () => {
    await tenantDb(makeCtx(tenantAId)).update(
      invitations,
      { email: "updated-a@example.com" },
      eq(invitations.id, invitationAId),
    );

    const [updated] = await db.select().from(invitations).where(eq(invitations.id, invitationAId));
    expect(updated.email).toBe("updated-a@example.com");

    await tenantDb(makeCtx(tenantAId)).delete(invitations, eq(invitations.id, invitationAId));

    const [deleted] = await db.select().from(invitations).where(eq(invitations.id, invitationAId));
    expect(deleted).toBeUndefined();
  });
});
