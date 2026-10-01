import { and, desc, eq, inArray } from "drizzle-orm";
import { bookingTypes, contacts, forms, leadSubmissions, sites } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import {
  createContact,
  getContact,
  getContactByPhone,
  addTagToContact,
} from "@/modules/crm/contacts";
import { createDeal } from "@/modules/crm/deals";
import { createActivity } from "@/modules/crm/activities";
import { leadEvents } from "./events";
import {
  buildLeadSubmissionView,
  type LeadFieldSiteSettings,
  type LeadOrigin,
  type LeadSubmissionView,
} from "./view";

// The single place an inbound lead becomes CRM data (PLAN.md §5.1), shared
// by both entry paths: the hosted form pages and the public ingest API.
// A lead is not its own entity — it upserts a `contact` (by phone) and
// optionally opens a `deal`, which is what the kanban already runs on.

export type LeadUtm = {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  gclid?: string;
  fbclid?: string;
};

export type RecordLeadInput = {
  /** Exactly one of siteId / formId / bookingTypeId identifies the entry path. */
  siteId?: string;
  formId?: string;
  bookingTypeId?: string;
  name?: string;
  phone: string;
  email?: string;
  /**
   * An e-mail the visitor typed that did not validate (§19.3 item 4). Kept on
   * the submission as typed; never written to the contact.
   */
  invalidEmail?: string;
  message?: string;
  source?: string;
  utm?: LeadUtm;
  pageUrl?: string;
  referrer?: string;
  ipAddress?: string;
  userAgent?: string;
  idempotencyKey?: string;
  /**
   * Hold back the *outcome* half — the deal, the timeline entry and the
   * `lead.received` emit — for the caller to release once the thing the lead
   * is about actually exists.
   *
   * The booking path needs this: a visitor who loses the race for a slot
   * keeps their contact row (deliberately — they tried to book, and the
   * owner wants to know) but must not end up with a deal in the pipeline and
   * a welcome automation for an appointment they do not have. The caller
   * releases it with `finalizeLeadSubmission` after the booking commits.
   */
  deferOutcome?: boolean;
  /** Raw submitted fields, kept verbatim for the timeline. */
  payload?: Record<string, unknown>;
  /** Repair codes from the ingest guard (§19.3); null/absent for a clean lead. */
  needsReview?: string[] | null;
  /** Per-site/form routing defaults, resolved by the caller (never by the client). */
  defaults?: {
    pipelineId?: string | null;
    stageId?: string | null;
    ownerUserId?: string | null;
    tagIds?: string[];
    dealTitle?: string;
  };
};

export type RecordLeadResult = {
  contactId: string;
  dealId: string | null;
  submissionId: string;
  /** True when an existing submission with the same idempotency key was returned. */
  duplicate: boolean;
};

const clip = (value: string | undefined, max: number) =>
  value === undefined || value === "" ? null : value.slice(0, max);

export async function recordLeadSubmission(
  ctx: TenantContext,
  input: RecordLeadInput,
): Promise<RecordLeadResult> {
  // Idempotency (§5.1): a retried POST returns the original result rather
  // than a duplicate contact. Checked before any write; the unique index on
  // (tenant_id, site_id, idempotency_key) is the backstop if two arrive at
  // once.
  if (input.idempotencyKey && input.siteId) {
    const [existing] = await tenantDb(ctx).select(
      leadSubmissions,
      and(
        eq(leadSubmissions.siteId, input.siteId),
        eq(leadSubmissions.idempotencyKey, input.idempotencyKey),
      ),
    );
    if (existing) {
      return {
        contactId: existing.contactId,
        dealId: existing.dealId,
        submissionId: existing.id,
        duplicate: true,
      };
    }
  }

  const defaults = input.defaults ?? {};
  const utm = input.utm ?? {};

  let contact = await getContactByPhone(ctx, input.phone);
  if (!contact) {
    contact = await createContact(ctx, {
      name: input.name || input.phone,
      phone: input.phone,
      email: input.email,
      source: input.source,
      ownerUserId: defaults.ownerUserId ?? undefined,
    });
    if (!contact) throw new Error("No se pudo crear el contacto");

    // First-touch attribution is stamped only on creation, never on a
    // returning contact — that's what makes it first-touch (§5.1).
    await tenantDb(ctx)
      .update(contacts)
      .set({ firstSiteId: input.siteId ?? null, firstTouchUtm: utm })
      .where(eq(contacts.id, contact.id));
  }

  for (const tagId of defaults.tagIds ?? []) {
    await addTagToContact(ctx, contact.id, tagId);
  }

  let dealId: string | null = null;
  if (!input.deferOutcome && defaults.pipelineId && defaults.stageId) {
    const deal = await createDeal(ctx, {
      contactId: contact.id,
      pipelineId: defaults.pipelineId,
      stageId: defaults.stageId,
      title: defaults.dealTitle || `Lead — ${contact.name}`,
      assignedUserId: defaults.ownerUserId ?? undefined,
    });
    dealId = deal?.id ?? null;
  }

  const submissionId = newId();
  await tenantDb(ctx)
    .insert(leadSubmissions)
    .values({
      id: submissionId,
      siteId: input.siteId,
      formId: input.formId,
      bookingTypeId: input.bookingTypeId,
      contactId: contact.id,
      dealId,
      payload: (input.payload ?? {}) as object,
      utm: utm as object,
      pageUrl: input.pageUrl,
      referrer: input.referrer,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      idempotencyKey: input.idempotencyKey,
      notes: input.message,
      // The per-submission snapshot (§19.3 item 6), on every entry path.
      // Clipped to the columns so the snapshot can never be what fails a
      // lead that would otherwise be stored.
      submittedName: clip(input.name, 200),
      submittedEmail: clip(input.email ?? input.invalidEmail, 320),
      submittedPhone: clip(input.phone, 30),
      source: clip(input.source, 100),
      needsReview: input.needsReview?.length ? input.needsReview : null,
    });

  if (input.deferOutcome) {
    // The row and the contact exist; the deal, the timeline entry and the
    // event wait for `finalizeLeadSubmission`.
    return { contactId: contact.id, dealId: null, submissionId, duplicate: false };
  }

  await createActivity(ctx, {
    contactId: contact.id,
    dealId: dealId ?? undefined,
    type: "form_submission",
    payload: {
      submissionId,
      siteId: input.siteId,
      formId: input.formId,
      bookingTypeId: input.bookingTypeId,
      message: input.message,
      utm,
      pageUrl: input.pageUrl,
      data: input.payload ?? {},
    },
  });

  await leadEvents.emit("lead.received", {
    tenantId: ctx.tenantId,
    contactId: contact.id,
    dealId,
    submissionId,
    siteId: input.siteId ?? null,
    formId: input.formId ?? null,
  });

  return { contactId: contact.id, dealId, submissionId, duplicate: false };
}

/**
 * Releases what `deferOutcome` held back: opens the deal, puts the
 * submission on the timeline, and emits `lead.received` — once, and only
 * once, whatever the caller does.
 *
 * Idempotent by the submission's own `deal_id`, so a retry cannot open a
 * second deal or re-fire a welcome flow. A submission that never reaches
 * here stays exactly what it is: a record that someone tried.
 */
export async function finalizeLeadSubmission(
  ctx: TenantContext,
  submissionId: string,
  defaults: NonNullable<RecordLeadInput["defaults"]> = {},
): Promise<string | null> {
  const [row] = await tenantDb(ctx).select(
    leadSubmissions,
    eq(leadSubmissions.id, submissionId),
  );
  if (!row) return null;
  if (row.dealId) return row.dealId;

  const contact = await getContact(ctx, row.contactId);
  if (!contact) return null;

  let dealId: string | null = null;
  if (defaults.pipelineId && defaults.stageId) {
    const deal = await createDeal(ctx, {
      contactId: row.contactId,
      pipelineId: defaults.pipelineId,
      stageId: defaults.stageId,
      title: defaults.dealTitle || `Lead — ${contact.name}`,
      assignedUserId: defaults.ownerUserId ?? undefined,
    });
    dealId = deal?.id ?? null;
  }

  if (dealId) {
    await tenantDb(ctx)
      .update(leadSubmissions)
      .set({ dealId })
      .where(eq(leadSubmissions.id, submissionId));
  }

  await createActivity(ctx, {
    contactId: row.contactId,
    dealId: dealId ?? undefined,
    type: "form_submission",
    payload: {
      submissionId,
      siteId: row.siteId,
      formId: row.formId,
      bookingTypeId: row.bookingTypeId,
      message: row.notes,
      utm: row.utm ?? {},
      pageUrl: row.pageUrl,
      data: row.payload ?? {},
    },
  });

  await leadEvents.emit("lead.received", {
    tenantId: ctx.tenantId,
    contactId: row.contactId,
    dealId,
    submissionId,
    siteId: row.siteId ?? null,
    formId: row.formId ?? null,
  });

  return dealId;
}

export type LeadSubmissionRow = typeof leadSubmissions.$inferSelect;

// Reads for the lead card (PLAN.md §19.2). Newest first; the tenant predicate
// comes from `tenantDb`, so another business's deal or contact id yields [].

export function listLeadSubmissionsForContact(
  ctx: TenantContext,
  contactId: string,
): Promise<LeadSubmissionRow[]> {
  return tenantDb(ctx)
    .select(leadSubmissions, eq(leadSubmissions.contactId, contactId))
    .orderBy(desc(leadSubmissions.createdAt), desc(leadSubmissions.id));
}

export function listLeadSubmissionsForDeal(
  ctx: TenantContext,
  dealId: string,
): Promise<LeadSubmissionRow[]> {
  return tenantDb(ctx)
    .select(leadSubmissions, eq(leadSubmissions.dealId, dealId))
    .orderBy(desc(leadSubmissions.createdAt), desc(leadSubmissions.id));
}

const distinct = (ids: Array<string | null>) => [
  ...new Set(ids.filter((id): id is string => !!id)),
];

/**
 * Turns submission rows into card view-models, in the same order. Where each
 * one came from (site, hosted form, booking type) is resolved in one batched
 * read per kind, not per row.
 */
export async function buildLeadSubmissionViews(
  ctx: TenantContext,
  rows: LeadSubmissionRow[],
  contact: { name: string; email: string | null; phone: string } | null,
  fieldNames: Record<string, string> = {},
): Promise<LeadSubmissionView[]> {
  if (rows.length === 0) return [];

  const siteIds = distinct(rows.map((row) => row.siteId));
  const formIds = distinct(rows.map((row) => row.formId));
  const bookingTypeIds = distinct(rows.map((row) => row.bookingTypeId));

  const [siteRows, formRows, bookingRows] = await Promise.all([
    siteIds.length ? tenantDb(ctx).select(sites, inArray(sites.id, siteIds)) : [],
    formIds.length ? tenantDb(ctx).select(forms, inArray(forms.id, formIds)) : [],
    bookingTypeIds.length
      ? tenantDb(ctx).select(bookingTypes, inArray(bookingTypes.id, bookingTypeIds))
      : [],
  ]);
  const siteById = new Map(siteRows.map((row) => [row.id, row]));
  const formById = new Map(formRows.map((row) => [row.id, row]));
  const bookingById = new Map(bookingRows.map((row) => [row.id, row]));

  return rows.map((row) => {
    const site = row.siteId ? siteById.get(row.siteId) : undefined;
    const form = row.formId ? formById.get(row.formId) : undefined;
    const booking = row.bookingTypeId ? bookingById.get(row.bookingTypeId) : undefined;

    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const origin: LeadOrigin = form
      ? { kind: "form", name: form.name, domain: null }
      : booking
        ? { kind: "booking", name: booking.name, domain: null }
        : {
            kind: payload.channel === "chat" ? "chat" : "site",
            name: site?.name ?? null,
            domain: site?.domain ?? null,
          };

    const formLabels: Record<string, string> = {};
    for (const field of (form?.fields ?? []) as Array<{ key?: string; label?: string }>) {
      if (field.key && field.label) formLabels[field.key] = field.label;
    }

    return buildLeadSubmissionView(row, {
      origin,
      contact,
      formLabels,
      siteSettings: (site?.settings ?? {}) as LeadFieldSiteSettings,
      fieldNames,
    });
  });
}
