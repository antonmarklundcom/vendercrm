import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability";
import { handleDeliveryEvents } from "@/modules/mailbox/events";

// Bounce / complaint events relayed by the Cloudflare Worker's queue
// consumer (PLAN-EMAIL.md E5). See modules/mailbox/events.ts.

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const result = await handleDeliveryEvents(rawBody, request.headers);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    reportError(err, { tags: { route: "email.events" } });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
