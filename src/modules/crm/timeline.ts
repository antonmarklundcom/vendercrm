import { eq } from "drizzle-orm";
import { documents, quotes } from "@/db/schema";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import {
  listConversationsForContact,
  listMessagesForConversation,
} from "@/modules/whatsapp/inbox";
import { listNotesForContact } from "@/modules/whatsapp/notes";
import {
  buildLeadSubmissionViews,
  listLeadSubmissionsForContact,
} from "@/modules/leads/submissions";
import type { LeadSubmissionView } from "@/modules/leads/view";
import { getContact } from "./contacts";
import { listActivitiesForContact, type ActivityType } from "./activities";

// Unified contact timeline (PLAN.md §5: "activities + WhatsApp messages +
// form submissions + quotes"). Until now the contact page showed activities
// only, so a rep opening a record could not see the conversation that
// produced it or the quote they sent — they had to go find both in other
// screens. This assembles the whole relationship in one ordered list.

export type TimelineEntry =
  | {
      kind: "activity";
      id: string;
      at: Date;
      activityType: ActivityType;
      text?: string;
    }
  | {
      kind: "message";
      id: string;
      at: Date;
      direction: "in" | "out";
      body: string | null;
      messageType: string;
      status: string | null;
      hasMedia: boolean;
    }
  | {
      kind: "quote";
      id: string;
      at: Date;
      number: string;
      status: string;
      total: number;
      currency: string;
    }
  | {
      // Notas de venta (§10 1Q). Added after the timeline shipped: without
      // it a document issued against a contact was invisible on the record
      // it belongs to, which defeats the "whole relationship in one place"
      // this list exists for.
      kind: "document";
      id: string;
      at: Date;
      number: string;
      status: string;
      total: number;
      currency: string;
    }
  | {
      kind: "lead";
      id: string;
      at: Date;
      view: LeadSubmissionView;
    }
  | {
      // An inbox internal note (§15.8 P3) — never sent, distinct from the
      // "note" ActivityType a rep types straight onto the contact record.
      kind: "conversationNote";
      id: string;
      at: Date;
      body: string;
      authorUserId: string;
    };

/**
 * Everything that ever happened with this contact, newest first.
 *
 * Assembled in memory from five tenant-scoped reads rather than a UNION: the
 * per-contact row counts are small, and each source already has a service
 * that applies the tenant predicate — reaching for raw SQL here would mean
 * rebuilding those guarantees by hand.
 */
export async function getContactTimeline(
  ctx: TenantContext,
  contactId: string,
  /** The i18n dictionary of common form keys; without it labels are humanized. */
  fieldNames: Record<string, string> = {},
): Promise<TimelineEntry[]> {
  const [activities, conversations, contactQuotes, contactDocuments, leadRows, notes, contact] =
    await Promise.all([
      listActivitiesForContact(ctx, contactId),
      listConversationsForContact(ctx, contactId),
      tenantDb(ctx).select(quotes, eq(quotes.contactId, contactId)),
      tenantDb(ctx).select(documents, eq(documents.contactId, contactId)),
      listLeadSubmissionsForContact(ctx, contactId),
      listNotesForContact(ctx, contactId),
      getContact(ctx, contactId),
    ]);
  const leads = await buildLeadSubmissionViews(ctx, leadRows, contact, fieldNames);

  const messages = (
    await Promise.all(
      conversations.map((conversation) =>
        listMessagesForConversation(ctx, conversation.id),
      ),
    )
  ).flat();

  const entries: TimelineEntry[] = [
    // Every form_submission activity has a lead_submissions twin (§19.1), and
    // the activity copy carries no text — it would only repeat the lead entry
    // below as an empty "Formulario" row.
    ...activities
      .filter((activity) => activity.type !== "form_submission")
      .map(
        (activity): TimelineEntry => ({
          kind: "activity",
          id: activity.id,
          at: activity.createdAt,
          activityType: activity.type as ActivityType,
          text: (activity.payload as { text?: string })?.text,
        }),
      ),
    ...messages.map(
      (message): TimelineEntry => ({
        kind: "message",
        id: message.id,
        at: message.createdAt,
        direction: message.direction,
        body: message.body,
        messageType: message.type,
        status: message.status,
        hasMedia: Boolean(message.storageKey || message.mediaId),
      }),
    ),
    ...contactQuotes.map(
      (quote): TimelineEntry => ({
        kind: "quote",
        id: quote.id,
        at: quote.createdAt,
        number: quote.number,
        status: quote.status,
        total: quote.total,
        currency: quote.currency,
      }),
    ),
    ...contactDocuments.map(
      (document): TimelineEntry => ({
        kind: "document",
        id: document.id,
        // issuedAt is the date the customer sees on the document; a draft
        // has none yet, and until it does the timeline shows when it was
        // started.
        at: document.issuedAt ?? document.createdAt,
        number: document.number,
        status: document.status,
        total: document.total,
        currency: document.currency,
      }),
    ),
    ...leads.map(
      (view): TimelineEntry => ({
        kind: "lead",
        id: view.id,
        at: view.receivedAt,
        view,
      }),
    ),
    ...notes.map(
      (note): TimelineEntry => ({
        kind: "conversationNote",
        id: note.id,
        at: note.createdAt,
        body: note.body,
        authorUserId: note.authorUserId,
      }),
    ),
  ];

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}
