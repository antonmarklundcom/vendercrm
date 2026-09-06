import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { quoteAcceptances, quotes } from "@/db/schema";
import { newId } from "@/lib/ids";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { createActivity } from "@/modules/crm/activities";
import { getQuote, setQuoteStatus } from "./quotes";
import { quoteEvents } from "./events";

// Public accept/reject (PLAN.md §8, §15.5 J4b, §15.8 P6) — the visitor's own
// decision on a quote they were sent. Reopens §11's "no client-side accept
// button yet" deferral on purpose.
//
// modules/quotes is already raw-`db`-exempt (eslint.config.mjs): the public
// token lookup below runs before any TenantContext exists, structurally the
// same as `getPublicQuote`.

export type QuoteDecisionInput = {
  decision: "accepted" | "rejected";
  name: string;
  comment?: string;
  ipAddress?: string;
  userAgent?: string;
};

export type QuoteDecisionOutcome =
  | { ok: true }
  | { ok: false; reason: "rateLimited" | "invalid" | "alreadyDecided" | "notSent" | "expired" };

export async function decideQuote(
  token: string,
  input: QuoteDecisionInput,
): Promise<QuoteDecisionOutcome> {
  if (input.ipAddress) {
    const limit = await checkRateLimit(`quote-decision:${input.ipAddress}`, 10, 60_000);
    if (limit.limited) return { ok: false, reason: "rateLimited" };
  }

  const [quote] = await db.select().from(quotes).where(eq(quotes.publicToken, token));
  if (!quote) return { ok: false, reason: "invalid" };

  const ctx = await buildSystemTenantContext(quote.tenantId);
  if (!ctx) return { ok: false, reason: "invalid" };

  if (quote.status === "expired") return { ok: false, reason: "expired" };
  if (quote.status === "accepted" || quote.status === "rejected") {
    return { ok: false, reason: "alreadyDecided" };
  }
  if (quote.status !== "sent") return { ok: false, reason: "notSent" };

  try {
    await tenantDb(ctx)
      .insert(quoteAcceptances)
      .values({
        id: newId(),
        quoteId: quote.id,
        decision: input.decision,
        name: input.name.slice(0, 200),
        comment: input.comment?.slice(0, 1000),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent?.slice(0, 500),
      });
  } catch {
    // The unique index on quote_id is the backstop against a race (two tabs
    // submitting at once) — the status check above catches the common case,
    // this catches the rest.
    return { ok: false, reason: "alreadyDecided" };
  }

  await setQuoteStatus(ctx, quote.id, input.decision);

  // No new ActivityType (crm/activities.ts is outside this phase's Owns
  // column, and its enum is a hard limit elsewhere) — a generic `system`
  // entry, the same pattern P4's "enviar por email" buttons used.
  await createActivity(ctx, {
    contactId: quote.contactId,
    dealId: quote.dealId ?? undefined,
    type: "system",
    payload: {
      kind: input.decision === "accepted" ? "quote_accepted" : "quote_rejected",
      quoteId: quote.id,
      number: quote.number,
      name: input.name,
      comment: input.comment,
    },
  });

  if (input.decision === "accepted") {
    await quoteEvents.emit("quote.accepted", {
      tenantId: ctx.tenantId,
      contactId: quote.contactId,
      quoteId: quote.id,
      dealId: quote.dealId ?? null,
      number: quote.number,
      total: quote.total,
      currency: quote.currency,
    });
  } else {
    await quoteEvents.emit("quote.rejected", {
      tenantId: ctx.tenantId,
      contactId: quote.contactId,
      quoteId: quote.id,
      dealId: quote.dealId ?? null,
      number: quote.number,
    });
  }

  return { ok: true };
}

/** What the public page needs to know about a prior decision, if there is
 *  one — shown instead of the accept/reject buttons. */
export async function getQuoteDecision(quoteId: string, tenantId: string) {
  const ctx = await buildSystemTenantContext(tenantId);
  if (!ctx) return null;
  const [row] = await tenantDb(ctx).select(quoteAcceptances, eq(quoteAcceptances.quoteId, quoteId));
  return row ?? null;
}

// Re-exported so callers of this module don't also need modules/quotes/quotes
// for the one read the public page and its actions share.
export { getQuote };
