const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export class GraphApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Graph API error ${status}: ${JSON.stringify(body)}`);
  }
}

async function graphRequest(path: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(`${GRAPH_API_BASE}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new GraphApiError(res.status, body);
  return body;
}

export async function fetchTemplates(wabaId: string, accessToken: string) {
  const data = await graphRequest(
    `${wabaId}/message_templates?fields=name,language,category,status,components&limit=200`,
    accessToken,
  );
  return (data.data ?? []) as Array<{
    name: string;
    language: string;
    category: string;
    status: string;
    components: unknown[];
  }>;
}

export type OutboundMessagePayload =
  | { type: "text"; text: { body: string } }
  | {
      type: "template";
      template: {
        name: string;
        language: { code: string };
        components?: unknown[];
      };
    };

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  payload: OutboundMessagePayload,
) {
  const data = await graphRequest(`${phoneNumberId}/messages`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      ...payload,
    }),
  });

  return data as { messages?: Array<{ id: string }> };
}

export async function fetchMediaUrl(mediaId: string, accessToken: string) {
  const data = await graphRequest(mediaId, accessToken);
  return data as { url: string; mime_type: string; file_size: number };
}

export async function downloadMedia(url: string, accessToken: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new GraphApiError(res.status, await res.text());
  return Buffer.from(await res.arrayBuffer());
}
