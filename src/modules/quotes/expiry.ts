import { and, eq, lt } from "drizzle-orm";
import { quotes } from "@/db/schema";
import { buildSystemTenantContext } from "@/modules/tenancy/context";
import { listTenants } from "@/modules/tenancy/tenants";
import { tenantDb } from "@/modules/tenancy/db";
import { setQuoteStatus } from "./quotes";

// Quote expiry (PLAN.md §15.5 J12, §15.8 P6): a `sent` quote past its
// `validUntil` becomes `expired`, so the public page can say why it can't be
// accepted anymore rather than leaving a stale accept button live forever.
//
// Same shape as crm/task-reminders.ts's daily sweep: one pass over every
// tenant, each read/write through its own tenantDb.

export async function expireQuotes(now: Date = new Date()): Promise<number> {
  let expired = 0;

  for (const tenant of await listTenants()) {
    const ctx = await buildSystemTenantContext(tenant.id);
    if (!ctx) continue;

    const overdue = await tenantDb(ctx).select(
      quotes,
      and(eq(quotes.status, "sent"), lt(quotes.validUntil, now)),
    );
    // `validUntil` is nullable (§8: a quote need not have one); `lt` against
    // a null column never matches, so an evergreen quote is correctly never
    // swept here.

    for (const quote of overdue) {
      await setQuoteStatus(ctx, quote.id, "expired");
      expired += 1;
    }
  }

  return expired;
}
