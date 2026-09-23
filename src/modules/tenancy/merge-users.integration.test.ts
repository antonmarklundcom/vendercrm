import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Folding a duplicate account into another one ("mover accesos"), against a
// real database. The property that matters: every business the source could
// reach, the target can reach afterwards (unless it already could), the
// source's role is what got copied, businesses the target already had are
// left alone, and the source ends up banned rather than deleted.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  const { db } = await import("@/db/client");
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe.skipIf(!hasDb)("mergeUsers (MySQL integration)", () => {
  let users: typeof import("./users");
  let memberships: typeof import("./memberships");
  let tenantsMod: typeof import("./tenants");
  let newId: (typeof import("@/lib/ids"))["newId"];
  const superadmin = { userId: "sa-merge", impersonatorUserId: null } as const;

  let tenantA: string;
  let tenantB: string;
  let tenantC: string;

  beforeAll(async () => {
    users = await import("./users");
    memberships = await import("./memberships");
    tenantsMod = await import("./tenants");
    ({ newId } = await import("@/lib/ids"));

    const a = await tenantsMod.createTenant(superadmin, { name: "Merge A", slug: `merge-a-${newId()}`.toLowerCase() });
    const b = await tenantsMod.createTenant(superadmin, { name: "Merge B", slug: `merge-b-${newId()}`.toLowerCase() });
    const c = await tenantsMod.createTenant(superadmin, { name: "Merge C", slug: `merge-c-${newId()}`.toLowerCase() });
    tenantA = a!.id;
    tenantB = b!.id;
    tenantC = c!.id;
  });

  it("copies the source's memberships onto the target, skips ones the target already has, and bans the source", async () => {
    const source = await users.createTenantAdminUser({
      tenantId: tenantA,
      email: `source-${newId()}@example.com`,
      password: "Passw0rd!Passw0rd",
      name: "Source",
      role: "admin",
    });
    await memberships.addMembership({ userId: source!.id, tenantId: tenantB, role: "agent" });

    const target = await users.createTenantAdminUser({
      tenantId: tenantC,
      email: `target-${newId()}@example.com`,
      password: "Passw0rd!Passw0rd",
      name: "Target",
      role: "admin",
    });
    // Target is already in tenant B, as admin — the merge must not downgrade
    // this to the source's "agent" role there.
    await memberships.addMembership({ userId: target!.id, tenantId: tenantB, role: "admin" });

    const result = await users.mergeUsers(source!.id, target!.id);

    expect(result.copiedTenantIds).toEqual([tenantA]);
    expect(result.skippedTenantIds).toEqual([tenantB]);

    const targetMemberships = await memberships.listMembershipsForUser(target!.id);
    const byTenant = new Map(targetMemberships.map((m) => [m.tenant.id, m.membership.role]));
    expect(byTenant.get(tenantA)).toBe("admin"); // copied with the source's role
    expect(byTenant.get(tenantB)).toBe("admin"); // target's own role kept, not overwritten
    expect(byTenant.get(tenantC)).toBe("admin"); // target's original business untouched

    const sourceRow = await users.getUserById(source!.id);
    expect(sourceRow?.banned).toBe(true);
    expect(sourceRow?.banReason).toBe(`fusionada con ${target!.email}`);
  });

  it("refuses to merge a superadmin, and refuses a source merged into itself", async () => {
    const { UserMergeError } = users;

    const person = await users.createTenantAdminUser({
      tenantId: tenantA,
      email: `solo-${newId()}@example.com`,
      password: "Passw0rd!Passw0rd",
      name: "Solo",
    });

    await expect(users.mergeUsers(person!.id, person!.id)).rejects.toBeInstanceOf(UserMergeError);
    try {
      await users.mergeUsers(person!.id, person!.id);
      throw new Error("expected mergeUsers to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UserMergeError);
      expect((err as InstanceType<typeof UserMergeError>).code).toBe("same");
    }

    const superadminUser = await users.createSuperadminUser({
      email: `super-${newId()}@example.com`,
      password: "Passw0rd!Passw0rd",
      name: "Super",
    });

    try {
      await users.mergeUsers(superadminUser!.id, person!.id);
      throw new Error("expected mergeUsers to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UserMergeError);
      expect((err as InstanceType<typeof UserMergeError>).code).toBe("superadmin");
    }
    try {
      await users.mergeUsers(person!.id, superadminUser!.id);
      throw new Error("expected mergeUsers to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UserMergeError);
      expect((err as InstanceType<typeof UserMergeError>).code).toBe("superadmin");
    }
  });
});
