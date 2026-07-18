import { env } from "@/lib/config/env";
import { decryptAccessToken, type WaAccount } from "./accounts";

// Thin Meta Graph API client. `fetch` is injectable so the send/processing
// jobs can be tested without hitting Meta (setGraphFetch in tests).

type FetchFn = typeof fetch;
let fetchImpl: FetchFn = (...args) => globalThis.fetch(...args);
export function setGraphFetch(fn: FetchFn) {
  fetchImpl = fn;
}
export function resetGraphFetch() {
  fetchImpl = (...args) => globalThis.fetch(...args);
}

const BASE = "https://graph.facebook.com";

export class GraphError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "GraphError";
  }
  // 5xx and 429 are worth retrying; 4xx (bad request, expired token) are not
  // (PLAN.md §6.4).
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

function tokenOrThrow(account: WaAccount): string {
  const token = decryptAccessToken(account);
  if (!token) throw new GraphError(400, "WhatsApp account has no access token");
  return token;
}

async function graphPost(
  account: WaAccount,
  path: string,
  body: unknown,
): Promise<{ messageId?: string; raw: unknown }> {
  const token = tokenOrThrow(account);
  const res = await fetchImpl(`${BASE}/${env.META_GRAPH_VERSION}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new GraphError(res.status, `Graph POST ${path} failed`, raw);
  }
  const messageId = (raw as { messages?: { id: string }[] })?.messages?.[0]?.id;
  return { messageId, raw };
}

export async function sendText(
  account: WaAccount,
  to: string,
  body: string,
): Promise<{ messageId?: string }> {
  const { messageId } = await graphPost(account, `${account.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
  return { messageId };
}

// Uploads bytes to Meta and returns a media id, so documents (e.g. quote
// PDFs) can be sent without needing a publicly reachable URL — required since
// the local storage driver's URLs aren't internet-accessible in dev/Hostinger
// bootstrap (PLAN.md §2.1, §8).
export async function uploadMedia(
  account: WaAccount,
  bytes: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const token = tokenOrThrow(account);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mimeType }),
    filename,
  );
  const res = await fetchImpl(
    `${BASE}/${env.META_GRAPH_VERSION}/${account.phoneNumberId}/media`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const raw = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok || !raw.id) {
    throw new GraphError(res.status, "Graph media upload failed", raw);
  }
  return raw.id;
}

export async function sendDocument(
  account: WaAccount,
  to: string,
  input: { mediaId: string; filename: string; caption?: string },
): Promise<{ messageId?: string }> {
  const { messageId } = await graphPost(account, `${account.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      id: input.mediaId,
      filename: input.filename,
      ...(input.caption ? { caption: input.caption } : {}),
    },
  });
  return { messageId };
}

export async function sendTemplate(
  account: WaAccount,
  to: string,
  input: { name: string; language: string; components?: unknown[] },
): Promise<{ messageId?: string }> {
  const { messageId } = await graphPost(account, `${account.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: input.name,
      language: { code: input.language },
      ...(input.components ? { components: input.components } : {}),
    },
  });
  return { messageId };
}

// Media URLs from Meta expire quickly, so callers fetch immediately and persist
// via the storage adapter (PLAN.md §6.3).
export async function getMediaUrl(
  account: WaAccount,
  mediaId: string,
): Promise<string | null> {
  const token = tokenOrThrow(account);
  const res = await fetchImpl(`${BASE}/${env.META_GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const raw = (await res.json()) as { url?: string };
  return raw.url ?? null;
}

export async function downloadMedia(
  account: WaAccount,
  url: string,
): Promise<Buffer | null> {
  const token = tokenOrThrow(account);
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function fetchTemplates(
  account: WaAccount,
): Promise<
  { name: string; language: string; category?: string; status: string; components?: unknown }[]
> {
  const token = tokenOrThrow(account);
  const res = await fetchImpl(
    `${BASE}/${env.META_GRAPH_VERSION}/${account.wabaId}/message_templates?limit=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new GraphError(res.status, "Failed to fetch templates");
  const raw = (await res.json()) as {
    data?: {
      name: string;
      language: string;
      category?: string;
      status: string;
      components?: unknown;
    }[];
  };
  return raw.data ?? [];
}
