import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import { verifyWebhookSignature } from "@/modules/whatsapp/signature";
import { recordWebhookEvent } from "@/modules/whatsapp/platform";
import { enqueue } from "@/lib/queue";
import { WHATSAPP_PROCESS_WEBHOOK } from "@/modules/whatsapp/jobs";

// One endpoint for the whole platform; Meta posts all tenants' traffic here,
// routed later by phone_number_id (PLAN.md §6.3).

// GET: Meta's subscription verification handshake. Echo hub.challenge back when
// the verify token matches.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (
    mode === "subscribe" &&
    env.META_WEBHOOK_VERIFY_TOKEN &&
    token === env.META_WEBHOOK_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// POST: verify signature, persist the raw event, enqueue processing, return 200
// — fast, no business logic. Meta retries on non-200/slow responses and pauses
// the subscription on persistent failure, so acking fast is non-negotiable
// (PLAN.md §6.3 rule 2). The route never throws.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Fail closed if the app secret isn't configured — we can't trust the body.
  if (!env.META_APP_SECRET) {
    return new NextResponse("WhatsApp not configured", { status: 503 });
  }
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(rawBody, signature, env.META_APP_SECRET)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    const phoneNumberId = extractPhoneNumberId(payload);
    const eventId = await recordWebhookEvent({ phoneNumberId, payload });
    await enqueue(WHATSAPP_PROCESS_WEBHOOK, { webhookEventId: eventId });
  } catch (err) {
    // Never crash the route — a 500 would make Meta retry and eventually pause
    // the subscription. Log and ack; the raw event (if persisted) can be
    // replayed from the health view.
    console.error("[whatsapp] webhook accept failed", err);
  }

  return new NextResponse(null, { status: 200 });
}

function extractPhoneNumberId(payload: unknown): string | null {
  try {
    const p = payload as {
      entry?: { changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[];
    };
    return (
      p.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null
    );
  } catch {
    return null;
  }
}
