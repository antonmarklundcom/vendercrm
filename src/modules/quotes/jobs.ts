import { registerHandler } from "@/worker/handlers";
import { tenantContextFromJob } from "@/modules/tenancy/context";
import { markQuoteSent } from "./service";

export const QUOTES_MARK_SENT = "quotes.mark_sent";

// Fired by whatsapp/send.ts's onDelivered chain once the document message is
// confirmed sent — flips the quote to `sent` and writes the timeline entry
// only after real delivery, not at enqueue time (PLAN.md §8).
registerHandler(QUOTES_MARK_SENT, async (payload, tenantId) => {
  const { quoteId } = payload as { quoteId: string };
  if (!tenantId) return;
  const ctx = tenantContextFromJob({ tenantId });
  await markQuoteSent(ctx, quoteId);
});
