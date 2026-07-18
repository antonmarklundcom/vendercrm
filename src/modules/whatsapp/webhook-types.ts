// Shapes for the subset of Meta's WhatsApp Cloud API webhook payload this
// app understands. Anything else falls through to `type: "unsupported"`.

export type InboundMediaMessage = {
  id: string;
  mime_type: string;
  caption?: string;
};

export type InboundMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: InboundMediaMessage;
  document?: InboundMediaMessage;
  audio?: InboundMediaMessage;
  video?: InboundMediaMessage;
};

export type MessageStatusUpdate = {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  errors?: Array<{ code: number; title: string }>;
};

export type WhatsAppChangeValue = {
  messaging_product: "whatsapp";
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: Array<{ profile: { name: string }; wa_id: string }>;
  messages?: InboundMessage[];
  statuses?: MessageStatusUpdate[];
};

export type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    id: string;
    changes: Array<{ value: WhatsAppChangeValue; field: string }>;
  }>;
};

export function extractPhoneNumberId(payload: unknown): string | null {
  const p = payload as WhatsAppWebhookPayload;
  return p?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;
}

export function extractChangeValues(payload: unknown): WhatsAppChangeValue[] {
  const p = payload as WhatsAppWebhookPayload;
  const values: WhatsAppChangeValue[] = [];

  for (const entry of p?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.value) values.push(change.value);
    }
  }

  return values;
}

const MEDIA_FIELDS = ["image", "document", "audio", "video"] as const;

export function mediaFieldFor(message: InboundMessage): (typeof MEDIA_FIELDS)[number] | null {
  for (const field of MEDIA_FIELDS) {
    if (message[field]) return field;
  }
  return null;
}
