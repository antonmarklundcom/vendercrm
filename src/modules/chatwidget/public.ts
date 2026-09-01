import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { chatWidgets } from "@/db/schema";
import { env } from "@/lib/config/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { buildSystemTenantContext, type TenantContext } from "@/modules/tenancy/context";
import { getTenant } from "@/modules/tenancy/tenants";
import { getSite } from "@/modules/sites/sites";
import { siteTurnstileSecret, siteTurnstileSiteKey } from "@/modules/sites/settings";
import { hasRepliesForChatConversation } from "@/modules/ai/replies";
import {
  appendMessage,
  countVisitorMessages,
  findOpenConversation,
  getOrCreateConversation,
  listMessages,
  type ChatConversation,
  type ChatMessage,
} from "./conversations";
import { applyHandoffKeyword, generateChatReply } from "./reply";
import { captureVisitor } from "./capture";
import { chatEvents } from "./events";
import { originAllowed, type ChatWidget } from "./widgets";

// The public chat surface (docs/SPEC-CHAT-WIDGET.md §3).
//
// Resolving a widget key to a tenant happens *before* any TenantContext
// exists — the same platform-wide lookup the API key and the WhatsApp
// `phone_number_id` routing do, and covered by the same documented exemption
// (PLAN.md §3.3). Everything after it runs through a system context and
// tenantDb.
//
// **No CORS headers anywhere.** The widget is served from our own origin
// inside an iframe, so every request below is same-origin — which is what
// lets this feature exist without reopening §5.1's lock, and which is why
// the checks below are a *same-origin assertion* rather than the tenant's
// origin allowlist. The allowlist is about which page may embed the widget,
// and the only request that knows the answer is the iframe document itself
// (`/w/[widgetKey]`, see `embedRefererAllowed`).

export type ResolvedWidget = {
  widget: ChatWidget;
  ctx: TenantContext;
  tenant: NonNullable<Awaited<ReturnType<typeof getTenant>>>;
};

export async function resolveWidget(widgetKey: string): Promise<ResolvedWidget | null> {
  const [widget] = await db
    .select()
    .from(chatWidgets)
    .where(eq(chatWidgets.widgetKey, widgetKey))
    .limit(1);
  if (!widget || !widget.isActive) return null;

  const ctx = await buildSystemTenantContext(widget.tenantId);
  if (!ctx) return null;

  const tenant = await getTenant(widget.tenantId);
  if (!tenant) return null;

  return { widget, ctx, tenant };
}

/**
 * The tenant's allowlist, checked where the answer is actually knowable: the
 * iframe document request, whose `Referer` is the embedding page. Called
 * from `/w/[widgetKey]/page.tsx`, which 404s on a miss — a widget that may
 * not be embedded here simply does not exist here.
 */
export function embedRefererAllowed(widget: ChatWidget, referer: string | null): boolean {
  return originAllowed((widget.allowedOrigins as string[] | null) ?? [], referer);
}

/**
 * Same-origin assertion for the chat's own API calls.
 *
 * Every one of them is a fetch from our iframe to our API: a POST carries
 * this CRM's own `Origin`, and the GET poll carries none at all. So the only
 * honest thing to check here is that it did not come from somewhere else —
 * an absent `Origin` (same-origin GET, or a non-browser client, which the
 * rate limits and spend caps are what actually bound) or our own is
 * accepted; a foreign one is refused. This is not the tenant's allowlist and
 * is not a substitute for it.
 */
export function sameOriginRequest(origin: string | null | undefined): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(env.APP_URL).origin;
  } catch {
    return false;
  }
}

/**
 * The Turnstile *site* key for a widget, or null when its site has none.
 *
 * Public by design — it renders into the iframe, the same category as the
 * widget key itself. The secret half is read only inside `postVisitorMessage`
 * and never leaves the server (§3.4).
 */
export async function widgetTurnstileSiteKey(
  resolved: ResolvedWidget,
): Promise<string | null> {
  const site = await getSite(resolved.ctx, resolved.widget.siteId);
  return site ? siteTurnstileSiteKey(site) : null;
}

/**
 * Whether this message still owes a verification, and whether it paid.
 *
 * The challenge is required before the **first provider call** of a
 * conversation, not before every message: a visitor solves it once and then
 * talks. "First" is read off `ai_replies`, which gets a row before each
 * provider request — so a call a guard refused leaves the challenge still
 * owed rather than spending it.
 *
 * Same ladder as §5.2.1: a site with no secret configured skips this
 * entirely, which is the state every existing site is in.
 */
async function turnstileSatisfied(
  ctx: TenantContext,
  widget: ChatWidget,
  conversationId: string,
  token: string | undefined,
  remoteIp: string | undefined,
): Promise<boolean> {
  if (await hasRepliesForChatConversation(ctx, conversationId)) return true;

  const site = await getSite(ctx, widget.siteId);
  const secret = site ? siteTurnstileSecret(site) : null;
  if (!secret) return true;

  const verdict = await verifyTurnstileToken({ secret, token, remoteIp });
  return verdict.ok;
}

export type ChatOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 403 | 404 | 422 | 429; error: string };

const MESSAGE_IP_LIMIT = 20;
const MESSAGE_VISITOR_LIMIT = 10;
const CAPTURE_VISITOR_LIMIT = 5;
/** The poll runs every 8s per open widget, so 15/min is generous for an
 * honest client and still bounds a scripted one — it was unlimited. */
const POLL_VISITOR_LIMIT = 15;
const WINDOW_MS = 60_000;

export const postMessageSchema = z.object({
  visitorId: z.string().min(10).max(26),
  body: z.string().min(1).max(2000),
  pageUrl: z.string().max(2000).optional(),
  referrer: z.string().max(2000).optional(),
  utm: z.record(z.string(), z.string().max(200)).optional(),
  locale: z.string().max(10).optional(),
  /** Cloudflare's token, sent with the first message of a conversation when
   * the widget's site has Turnstile configured (§1.2). */
  turnstileToken: z.string().max(4000).optional(),
});

export type PublicChatMessage = {
  id: string;
  author: "visitor" | "ai" | "agent" | "system";
  body: string;
  at: string;
};

export type PostMessageResult = {
  conversationId: string;
  messages: PublicChatMessage[];
  /** True once the widget should ask for a name and phone. */
  askForContact: boolean;
  /** Set when the AI drafted rather than sent — the visitor sees the wait copy. */
  pendingHuman: boolean;
};

export type RequestMeta = {
  origin?: string | null;
  ipAddress?: string;
  ipKey?: string;
  userAgent?: string;
};

export async function postVisitorMessage(
  widgetKey: string,
  rawBody: unknown,
  meta: RequestMeta = {},
  now: Date = new Date(),
): Promise<ChatOutcome<PostMessageResult>> {
  const resolved = await resolveWidget(widgetKey);
  if (!resolved) return { ok: false, status: 404, error: "not_found" };
  const { widget, ctx } = resolved;

  if (!sameOriginRequest(meta.origin)) {
    return { ok: false, status: 403, error: "origin_not_allowed" };
  }
  // A tenant in grace or locked is read-only at the write path (§10 1C
  // follow-up #1); answering here keeps the visitor from a 500.
  if (ctx.accessStatus !== "active") {
    return { ok: false, status: 403, error: "inactive" };
  }

  const parsed = postMessageSchema.safeParse(rawBody);
  if (!parsed.success) return { ok: false, status: 422, error: "invalid_body" };
  const body = parsed.data;

  const ip = meta.ipKey ?? meta.ipAddress ?? "unknown";
  if ((await checkRateLimit(`chat:ip:${widget.id}:${ip}`, MESSAGE_IP_LIMIT, WINDOW_MS)).limited) {
    return { ok: false, status: 429, error: "rate_limited" };
  }
  if (
    (await checkRateLimit(`chat:visitor:${body.visitorId}`, MESSAGE_VISITOR_LIMIT, WINDOW_MS)).limited
  ) {
    return { ok: false, status: 429, error: "rate_limited" };
  }

  const conversation = await getOrCreateConversation(ctx, {
    widgetId: widget.id,
    siteId: widget.siteId,
    visitorId: body.visitorId,
    pageUrl: body.pageUrl,
    referrer: body.referrer,
    utm: body.utm,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    locale: body.locale,
  });

  const isFirst = (await countVisitorMessages(ctx, conversation.id)) === 0;
  if (isFirst) {
    await chatEvents.emit("chat.started", {
      tenantId: ctx.tenantId,
      chatConversationId: conversation.id,
      widgetId: widget.id,
      siteId: widget.siteId,
    });
  }

  await appendMessage(
    ctx,
    {
      chatConversationId: conversation.id,
      direction: "in",
      author: "visitor",
      body: body.body,
    },
    now,
  );

  const handedOff = await applyHandoffKeyword(ctx, conversation.id, body.body);
  if (handedOff) {
    await chatEvents.emit("chat.handoff", {
      tenantId: ctx.tenantId,
      chatConversationId: conversation.id,
      widgetId: widget.id,
      siteId: widget.siteId,
    });
  }

  // The visitor's message is already captured above. A missing or rejected
  // token costs them the AI reply and nothing else — they get the same "a
  // person is coming" shape a tripped cap gives, never an error and never a
  // hint that they were treated as a bot.
  const verified = await turnstileSatisfied(
    ctx,
    widget,
    conversation.id,
    body.turnstileToken,
    meta.ipAddress,
  );

  const outcome = handedOff
    ? ({ status: "skipped", reason: "conversation_ai_disabled" } as const)
    : !verified
      ? ({ status: "skipped", reason: "turnstile_unverified" } as const)
      : await generateChatReply(
        ctx,
        { widget, chatConversationId: conversation.id, visitorMessage: body.body },
        now,
      );

  const messages = await listMessages(ctx, conversation.id);
  const visitorCount = await countVisitorMessages(ctx, conversation.id);

  return {
    ok: true,
    data: {
      conversationId: conversation.id,
      messages: messages.map(toPublicMessage),
      askForContact:
        widget.askForPhone &&
        !conversation.contactId &&
        visitorCount >= widget.captureAfterMessages,
      // Everything that is not a live send reads the same to the visitor: a
      // person is coming. A tripped spend cap must never surface the tenant's
      // billing state to their customer.
      pendingHuman: outcome.status !== "sent",
    },
  };
}

export const captureSchema = z.object({
  visitorId: z.string().min(10).max(26),
  name: z.string().max(200).optional(),
  phone: z.string().min(6).max(30),
  email: z.string().email().max(320).optional().or(z.literal("")),
});

export async function postCapture(
  widgetKey: string,
  rawBody: unknown,
  meta: RequestMeta = {},
): Promise<ChatOutcome<{ captured: true }>> {
  const resolved = await resolveWidget(widgetKey);
  if (!resolved) return { ok: false, status: 404, error: "not_found" };
  const { widget, ctx } = resolved;

  if (!sameOriginRequest(meta.origin)) {
    return { ok: false, status: 403, error: "origin_not_allowed" };
  }
  if (ctx.accessStatus !== "active") return { ok: false, status: 403, error: "inactive" };

  const parsed = captureSchema.safeParse(rawBody);
  if (!parsed.success) return { ok: false, status: 422, error: "invalid_body" };
  const body = parsed.data;

  if ((await checkRateLimit(`chat:capture:${body.visitorId}`, CAPTURE_VISITOR_LIMIT, WINDOW_MS)).limited) {
    return { ok: false, status: 429, error: "rate_limited" };
  }

  const conversation = await findConversation(ctx, widget, body.visitorId);
  if (!conversation) return { ok: false, status: 404, error: "not_found" };

  await captureVisitor(ctx, {
    widget,
    chatConversationId: conversation.id,
    name: body.name,
    phone: body.phone,
    email: body.email || undefined,
  });

  return { ok: true, data: { captured: true } };
}

export async function pollMessages(
  widgetKey: string,
  visitorId: string,
  sinceRaw: string | null,
  meta: RequestMeta = {},
): Promise<ChatOutcome<{ messages: PublicChatMessage[] }>> {
  const resolved = await resolveWidget(widgetKey);
  if (!resolved) return { ok: false, status: 404, error: "not_found" };
  const { widget, ctx } = resolved;

  if (!sameOriginRequest(meta.origin)) {
    return { ok: false, status: 403, error: "origin_not_allowed" };
  }

  const pollIp = meta.ipKey ?? meta.ipAddress ?? "unknown";
  if (
    (await checkRateLimit(`chat:poll:${visitorId}:${pollIp}`, POLL_VISITOR_LIMIT, WINDOW_MS)).limited
  ) {
    return { ok: false, status: 429, error: "rate_limited" };
  }

  const conversation = await findConversation(ctx, widget, visitorId);
  if (!conversation) return { ok: true, data: { messages: [] } };

  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  const messages = await listMessages(
    ctx,
    conversation.id,
    since && !Number.isNaN(since.getTime()) ? since : undefined,
  );
  return { ok: true, data: { messages: messages.map(toPublicMessage) } };
}

async function findConversation(
  ctx: TenantContext,
  widget: ChatWidget,
  visitorId: string,
): Promise<ChatConversation | null> {
  // getOrCreate would open an empty conversation for a probe; capture and
  // poll must only ever find one that already exists.
  return findOpenConversation(ctx, widget.id, visitorId);
}

/**
 * What the visitor is allowed to see: never the draft body, never the
 * prompt, never who is assigned. A draft is for the rep.
 */
function toPublicMessage(message: ChatMessage): PublicChatMessage {
  return {
    id: message.id,
    author: message.author,
    body: message.body ?? "",
    at: message.createdAt.toISOString(),
  };
}
