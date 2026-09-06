import { eq } from "drizzle-orm";
import { messages } from "@/db/schema";
import { getAiDriver } from "@/lib/ai";
import { storage } from "@/lib/storage";
import { getAiConfig } from "@/modules/ai/config";
import { countRepliesTodayForTenant, recordReply } from "@/modules/ai/replies";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";

// WhatsApp voice notes, transcribed (PLAN.md §15.3 "Lane A", §15.10 W1).
// Paraguayan customers send audios constantly and a rep who reads instead of
// listening moves faster — so the transcript is a column on the message, not
// a separate surface, and everything downstream (search, the AI auto-reply,
// the coach) reads it exactly where it reads `body`.
//
// The bytes are already in R2: the webhook downloads media the moment it
// arrives because Meta's media URLs expire (§6.3 rule 3). This module reads
// that object; it never goes back to the Graph API.

/**
 * WhatsApp caps a voice note at 16 MB itself, so this is a floor against a
 * pathological object rather than a policy — an opus voice note runs about
 * 1 MB for ten minutes. Duration is the limit §15.10 W1 names, but neither
 * the webhook payload nor the stored object carries it, and decoding the
 * container to find out would cost more than the transcription; the byte cap
 * stands in for it and is documented as such in docs/log/w1.md.
 */
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

/** Queue kind, defined here rather than in jobs.ts so the webhook can
 *  enqueue it without importing the worker's registration side effects. */
export const TRANSCRIBE_JOB_TYPE = "whatsapp.transcribe";

/** The market's language, sent as a hint and never as a filter — a voice
 *  note here mixes Spanish and Guaraní inside one sentence. */
const LANGUAGE_HINT = "es";

export type TranscribeOutcome =
  | { status: "done"; text: string }
  | { status: "skipped"; reason: TranscribeSkipReason }
  | { status: "failed"; reason: string };

export type TranscribeSkipReason =
  | "not_audio"
  | "no_media"
  | "already_transcribed"
  | "ai_not_configured"
  | "too_large"
  | "tenant_daily_cap";

type MessageRow = typeof messages.$inferSelect;

/**
 * Whether a freshly received message should be queued for transcription at
 * all. Pure and exported so the webhook and the tests agree on one rule.
 */
export function shouldTranscribe(message: {
  direction: string;
  type: string;
  storageKey: string | null;
}): boolean {
  return message.direction === "in" && message.type === "audio" && !!message.storageKey;
}

/**
 * Transcribes one stored voice note and writes the result onto its row.
 *
 * Terminal in every branch: the row always leaves this function with a
 * `transcript_status` a rep can read, so "no transcript" is never silent. A
 * provider error is recorded *and* rethrown — recorded so the inbox can say
 * why, rethrown so the queue's existing backoff gets its retries; a later
 * attempt that succeeds simply overwrites the row with `done`.
 */
export async function transcribeMessage(
  ctx: TenantContext,
  messageId: string,
): Promise<TranscribeOutcome> {
  const [row] = await tenantDb(ctx).select(messages, eq(messages.id, messageId));
  if (!row) return { status: "skipped", reason: "not_audio" };
  if (row.type !== "audio") return skip(ctx, row, "not_audio");
  if (!row.storageKey) return skip(ctx, row, "no_media");
  if (row.transcriptStatus === "done") {
    return { status: "done", text: row.transcript ?? "" };
  }

  const driver = getAiDriver();
  if (!driver) return skip(ctx, row, "ai_not_configured");

  // The same ceiling every other provider call answers to. Transcriptions
  // write `ai_replies` rows like replies do, so this is one budget rather
  // than two — the reason §15.10 W1 put audio behind this seam at all.
  const config = await getAiConfig(ctx);
  if ((await countRepliesTodayForTenant(ctx)) >= config.maxRepliesPerTenantPerDay) {
    return skip(ctx, row, "tenant_daily_cap");
  }

  // A stored object that will not read is not a provider problem and retrying
  // it forever helps nobody: the media URL it came from expired long ago.
  let audio: Buffer;
  try {
    audio = await storage.get(row.storageKey);
  } catch {
    return skip(ctx, row, "no_media");
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) return skip(ctx, row, "too_large");

  const mimeType = row.mediaMimeType ?? "audio/ogg";

  let result;
  try {
    result = await driver.transcribeAudio({ audio, mimeType, languageHint: LANGUAGE_HINT });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await tenantDb(ctx)
      .update(messages)
      .set({
        transcriptStatus: "failed",
        transcriptAt: new Date(),
        transcriptError: reason.slice(0, 500),
      })
      .where(eq(messages.id, row.id));
    // Failures are billed too — the same reason reply.ts persists them.
    await recordReply(ctx, {
      conversationId: row.conversationId,
      kind: "transcription",
      mode: "draft",
      status: "failed",
      prompt: transcriptionPrompt(row, mimeType),
      provider: driver.provider,
      model: driver.model,
      messageId: row.id,
      error: reason,
    });
    throw err;
  }

  await tenantDb(ctx)
    .update(messages)
    .set({
      transcript: result.text,
      transcriptStatus: "done",
      transcriptModel: result.model,
      transcriptAt: new Date(),
      transcriptError: null,
    })
    .where(eq(messages.id, row.id));

  await recordReply(ctx, {
    conversationId: row.conversationId,
    kind: "transcription",
    mode: "draft",
    status: "sent",
    prompt: transcriptionPrompt(row, mimeType),
    body: result.text,
    provider: driver.provider,
    model: result.model,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    messageId: row.id,
  });

  return { status: "done", text: result.text };
}

/** The ledger's prompt column is the audit trail; for audio the "prompt" is
 *  which object was sent and as what, since the bytes themselves cannot go
 *  in a text column. */
function transcriptionPrompt(row: MessageRow, mimeType: string): string {
  return `transcribe ${row.storageKey ?? "-"} (${mimeType})`;
}

async function skip(
  ctx: TenantContext,
  row: MessageRow,
  reason: TranscribeSkipReason,
): Promise<TranscribeOutcome> {
  await tenantDb(ctx)
    .update(messages)
    .set({ transcriptStatus: "skipped", transcriptAt: new Date(), transcriptError: reason })
    .where(eq(messages.id, row.id));
  return { status: "skipped", reason };
}
