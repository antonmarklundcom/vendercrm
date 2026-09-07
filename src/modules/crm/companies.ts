import { and, eq, ne } from "drizzle-orm";
import { companies, contacts, deals } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { writeAuditLog } from "@/modules/tenancy/audit";

// Companies (PLAN.md §15.5 J11c, §17.2/§17.3 P16) — the small half of the
// phase. A contact's own history stays on the contact regardless of which
// company it's filed under; this module only owns the company record
// itself and the pointer on `contacts.company_id`.

export type CompanyRow = typeof companies.$inferSelect;

export type CompanyInput = {
  name: string;
  ruc?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  custom?: Record<string, unknown>;
};

export class CompanyNameTakenError extends Error {
  constructor() {
    super("company_name_taken");
  }
}

/** Create/edit are admin+agent (any tenant member manages their own
 *  companies, same posture as contacts and deals); delete is admin-only and
 *  only while the company has no contacts, the §10 1S pattern. */
export async function createCompany(ctx: TenantContext, input: CompanyInput): Promise<CompanyRow> {
  const existing = await tenantDb(ctx).select(companies, eq(companies.name, input.name));
  if (existing.length > 0) throw new CompanyNameTakenError();

  const id = newId();
  await tenantDb(ctx)
    .insert(companies)
    .values({
      id,
      name: input.name.slice(0, 200),
      ruc: input.ruc,
      phone: input.phone,
      email: input.email,
      address: input.address,
      notes: input.notes,
      custom: input.custom ?? {},
    });
  return (await getCompany(ctx, id))!;
}

export async function updateCompany(
  ctx: TenantContext,
  id: string,
  input: CompanyInput,
): Promise<CompanyRow | null> {
  const existing = await tenantDb(ctx).select(
    companies,
    and(eq(companies.name, input.name), ne(companies.id, id)),
  );
  if (existing.length > 0) throw new CompanyNameTakenError();

  await tenantDb(ctx)
    .update(companies)
    .set({
      name: input.name.slice(0, 200),
      ruc: input.ruc,
      phone: input.phone,
      email: input.email,
      address: input.address,
      notes: input.notes,
      custom: input.custom ?? {},
    })
    .where(eq(companies.id, id));
  return getCompany(ctx, id);
}

export async function getCompany(ctx: TenantContext, id: string): Promise<CompanyRow | null> {
  const [row] = await tenantDb(ctx).select(companies, eq(companies.id, id));
  return row ?? null;
}

export type CompanyListRow = CompanyRow & { contactCount: number; openDealCount: number };

/** List with contact and open-deal counts — computed in Node over the
 *  tenant's own (small) companies/contacts/deals rows rather than a SQL
 *  join, matching `dashboard/summary.ts`'s existing precedent for counts
 *  this module doesn't otherwise need indexed. */
export async function listCompanies(ctx: TenantContext): Promise<CompanyListRow[]> {
  const [rows, contactRows, dealRows] = await Promise.all([
    tenantDb(ctx).select(companies),
    tenantDb(ctx).select(contacts),
    tenantDb(ctx).select(deals),
  ]);

  const contactsByCompany = new Map<string, string[]>();
  for (const contact of contactRows) {
    if (!contact.companyId) continue;
    const list = contactsByCompany.get(contact.companyId) ?? [];
    list.push(contact.id);
    contactsByCompany.set(contact.companyId, list);
  }

  const openDealsByContact = new Map<string, number>();
  for (const deal of dealRows) {
    if (deal.closedAt) continue;
    openDealsByContact.set(deal.contactId, (openDealsByContact.get(deal.contactId) ?? 0) + 1);
  }

  return rows
    .map((row) => {
      const contactIds = contactsByCompany.get(row.id) ?? [];
      const openDealCount = contactIds.reduce(
        (sum, contactId) => sum + (openDealsByContact.get(contactId) ?? 0),
        0,
      );
      return { ...row, contactCount: contactIds.length, openDealCount };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listContactsForCompany(ctx: TenantContext, companyId: string) {
  const rows = await tenantDb(ctx).select(contacts, eq(contacts.companyId, companyId));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listDealsForCompany(ctx: TenantContext, companyId: string) {
  const contactRows = await listContactsForCompany(ctx, companyId);
  const contactIds = new Set(contactRows.map((c) => c.id));
  const dealRows = await tenantDb(ctx).select(deals);
  return dealRows
    .filter((deal) => contactIds.has(deal.contactId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function setContactCompany(
  ctx: TenantContext,
  contactId: string,
  companyId: string | null,
): Promise<void> {
  await tenantDb(ctx).update(contacts).set({ companyId }).where(eq(contacts.id, contactId));
}

/** Admin-only (enforced by the caller via `requireTenantAdmin()`) and only
 *  while the company has no contacts filed under it — the §10 1S pattern
 *  applied to a company instead of a contact/deal. */
export async function deleteCompany(ctx: TenantContext, id: string): Promise<void> {
  const contactCount = (await listContactsForCompany(ctx, id)).length;
  if (contactCount > 0) {
    throw new Error(`company_has_contacts:${contactCount}`);
  }

  await tenantDb(ctx).delete(companies, eq(companies.id, id));
  await writeAuditLog({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    impersonatorUserId: ctx.impersonatorUserId,
    action: "company.delete",
    entity: "company",
    entityId: id,
    payload: {},
  });
}
