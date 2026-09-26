import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability";
import { handleInboundEmail } from "@/modules/mailbox/inbound";

// Inbound email from the Cloudflare Worker (workers/email-inbound,
// PLAN-EMAIL.md E2). The Worker signs every request; see
// modules/mailbox/inbound.ts for what each status means to it.

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const result = await handleInboundEmail(rawBody, request.headers);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    reportError(err, { tags: { route: "email.inbound" } });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
