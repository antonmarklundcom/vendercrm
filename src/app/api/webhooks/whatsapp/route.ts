import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import { recordWebhookEvent } from "@/modules/whatsapp/webhook-ingest";
import { extractPhoneNumberId } from "@/modules/whatsapp/webhook-types";

// Meta's one-time subscription verification handshake.
export function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && challenge && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(signatureHeader.slice("sha256=".length));

  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

// Ack-fast: persist the raw payload + enqueue processing, no business logic
// here. Meta retries (and eventually pauses the subscription) on slow or
// non-200 responses (PLAN.md §6.3).
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  await recordWebhookEvent(extractPhoneNumberId(payload), payload);

  return NextResponse.json({ ok: true });
}
