import { env } from "@/lib/config/env";
import { runStructured, toJsonSchema } from "./structured";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_STRUCTURED_OUTPUT_TOKENS,
  type AiDriver,
  type AiGenerateInput,
  type AiGenerateResult,
  type AiStructuredInput,
  type AiStructuredResult,
  type AiTranscribeInput,
  type AiTranscribeResult,
} from "./types";

// OpenAI driver (PLAN.md §10 1O). Plain `fetch` against the Chat Completions
// endpoint rather than the SDK: the surface used here is one POST, and not
// adding a dependency keeps the Hostinger bundle small (same reasoning as
// §2.3's @react-pdf/renderer choice over headless Chrome).

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
/** A model call that has not answered in a minute is not going to; release the process. */
const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = "gpt-4o-mini";
/**
 * Transcription is its own model on OpenAI — the chat model cannot take
 * audio on this endpoint at all — so it is not derived from `model`
 * (PLAN.md §15.10 W1). Overridable with AI_TRANSCRIBE_MODEL.
 */
const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
/** A voice note is a minute of speech, not a paragraph of tokens. */
const TRANSCRIBE_TIMEOUT_MS = 120_000;

export function createOpenAiDriver(
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseUrl: string = DEFAULT_BASE_URL,
  transcribeModel: string = DEFAULT_TRANSCRIBE_MODEL,
): AiDriver {
  async function post(body: Record<string, unknown>): Promise<AiGenerateResult> {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, ...body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`OpenAI request failed: ${res.status} ${errorBody.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };

    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("OpenAI returned an empty completion");

    return {
      text,
      model: json.model ?? model,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };
  }

  return {
    provider: "openai",
    model,

    generateReply(input: AiGenerateInput): Promise<AiGenerateResult> {
      return post({
        max_completion_tokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: input.system },
          ...input.messages.map((turn) => ({ role: turn.role, content: turn.content })),
        ],
      });
    },

    /**
     * JSON mode via `response_format`. Non-strict on purpose: strict mode
     * rejects perfectly ordinary zod output (optional fields without a null
     * branch, unions), and the answer is zod-validated on the way back
     * regardless — the schema here is a hint that makes the first attempt
     * usually work, not the thing that guarantees the shape.
     */
    generateStructured<T>(input: AiStructuredInput<T>): Promise<AiStructuredResult<T>> {
      const schema = toJsonSchema(input.schema);
      return runStructured(input, (repair) =>
        post({
          max_completion_tokens: input.maxOutputTokens ?? DEFAULT_MAX_STRUCTURED_OUTPUT_TOKENS,
          response_format: {
            type: "json_schema",
            json_schema: { name: input.schemaName ?? "respuesta", schema, strict: false },
          },
          messages: [
            { role: "system", content: repair ? `${input.system}\n\n${repair}` : input.system },
            ...input.messages.map((turn) => ({ role: turn.role, content: turn.content })),
          ],
        }),
      );
    },

    /**
     * `/audio/transcriptions`, multipart, no SDK — same reasoning as the
     * chat call above. The endpoint returns no usage block for the
     * transcribe models, so the token counts come back zero and the ledger
     * row is written for the audit trail and the daily cap rather than for
     * a token bill.
     */
    async transcribeAudio(input: AiTranscribeInput): Promise<AiTranscribeResult> {
      const form = new FormData();
      form.append("model", transcribeModel);
      form.append(
        "file",
        new Blob([new Uint8Array(input.audio)], { type: input.mimeType }),
        fileNameFor(input.mimeType),
      );
      if (input.languageHint) form.append("language", input.languageHint);

      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`OpenAI transcription failed: ${res.status} ${errorBody.slice(0, 300)}`);
      }

      const json = (await res.json()) as {
        text?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = json.text?.trim() ?? "";
      if (!text) throw new Error("OpenAI returned an empty transcription");

      return {
        text,
        model: transcribeModel,
        promptTokens: json.usage?.input_tokens ?? 0,
        completionTokens: json.usage?.output_tokens ?? 0,
      };
    },
  };
}

/**
 * The API rejects an upload whose filename has no extension it recognises,
 * even though the mime type is on the part — hence a name derived from the
 * mime type rather than the message id. WhatsApp voice notes are ogg/opus.
 */
function fileNameFor(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext =
    base === "audio/ogg" || base === "audio/opus"
      ? "ogg"
      : base === "audio/mpeg"
        ? "mp3"
        : base === "audio/mp4" || base === "audio/m4a" || base === "audio/x-m4a"
          ? "m4a"
          : base === "audio/amr"
            ? "amr"
            : base === "audio/wav" || base === "audio/x-wav"
              ? "wav"
              : base === "audio/webm"
                ? "webm"
                : "ogg";
  return `audio.${ext}`;
}

/** Built from env by lib/ai/index.ts; exported separately for tests. */
export function openAiDriverFromEnv(): AiDriver | null {
  if (!env.OPENAI_API_KEY) return null;
  return createOpenAiDriver(
    env.OPENAI_API_KEY,
    env.AI_MODEL ?? DEFAULT_MODEL,
    env.AI_BASE_URL ?? DEFAULT_BASE_URL,
    env.AI_TRANSCRIBE_MODEL ?? DEFAULT_TRANSCRIBE_MODEL,
  );
}
