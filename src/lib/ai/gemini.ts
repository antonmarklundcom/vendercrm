import { env } from "@/lib/config/env";
import { runStructured, toGeminiSchema, toJsonSchema } from "./structured";
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

// Gemini driver (PLAN.md §10 1O). Same contract as the OpenAI one; the two
// differences Google's API forces are that the system prompt is its own
// `systemInstruction` field rather than a message, and that the assistant
// role is spelled `model`.

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
/** A model call that has not answered in a minute is not going to; release the process. */
const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = "gemini-2.0-flash";
/**
 * Gemini takes audio on the same generateContent endpoint as text, so the
 * audio model defaults to the chat model rather than a separate one — the
 * opposite of OpenAI, and the reason AI_TRANSCRIBE_MODEL is a separate
 * setting instead of a driver constant (PLAN.md §15.10 W1).
 */
const DEFAULT_TRANSCRIBE_MODEL = DEFAULT_MODEL;
/** A voice note is a minute of speech, not a paragraph of tokens. */
const TRANSCRIBE_TIMEOUT_MS = 120_000;

/**
 * Instruction rather than conversation: the model is being asked to write
 * down what it hears, not to answer it. Explicit about *not* translating,
 * because a Spanish-and-Guaraní voice note otherwise comes back tidied into
 * one language and the rep loses what the customer actually said.
 */
const TRANSCRIBE_PROMPT =
  "Transcribí este audio literalmente, en el idioma en que fue hablado. " +
  "No traduzcas, no resumas, no agregues comentarios: devolvé solamente el texto dicho.";

export function createGeminiDriver(
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseUrl: string = DEFAULT_BASE_URL,
  transcribeModel: string = DEFAULT_TRANSCRIBE_MODEL,
): AiDriver {
  async function post(
    system: string,
    messages: AiGenerateInput["messages"],
    generationConfig: Record<string, unknown>,
  ): Promise<AiGenerateResult> {
    const url = `${baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((turn) => ({
          role: turn.role === "assistant" ? "model" : "user",
          parts: [{ text: turn.content }],
        })),
        generationConfig,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini request failed: ${res.status} ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      modelVersion?: string;
    };

    const text =
      json.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";
    if (!text) throw new Error("Gemini returned an empty completion");

    return {
      text,
      model: json.modelVersion ?? model,
      promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  return {
    provider: "gemini",
    model,

    generateReply(input: AiGenerateInput): Promise<AiGenerateResult> {
      return post(input.system, input.messages, {
        maxOutputTokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      });
    },

    /**
     * JSON mode is `responseMimeType` + `responseSchema`. The schema is
     * pruned to the OpenAPI subset Google accepts (see toGeminiSchema):
     * unlike OpenAI, Gemini rejects the request outright on a keyword it
     * does not know, so an unpruned zod-derived schema would fail every
     * call rather than degrade to a hint.
     */
    generateStructured<T>(input: AiStructuredInput<T>): Promise<AiStructuredResult<T>> {
      const schema = toGeminiSchema(toJsonSchema(input.schema));
      return runStructured(input, (repair) =>
        post(repair ? `${input.system}\n\n${repair}` : input.system, input.messages, {
          maxOutputTokens: input.maxOutputTokens ?? DEFAULT_MAX_STRUCTURED_OUTPUT_TOKENS,
          responseMimeType: "application/json",
          responseSchema: schema,
        }),
      );
    },

    /**
     * Audio is an `inline_data` part on the ordinary generateContent call —
     * no upload step for a file this size, and one round trip. Usage comes
     * back the same way it does for text, so a voice note lands in the
     * ledger with real token counts on this provider.
     */
    async transcribeAudio(input: AiTranscribeInput): Promise<AiTranscribeResult> {
      const url = `${baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(transcribeModel)}:generateContent`;
      const prompt = input.languageHint
        ? `${TRANSCRIBE_PROMPT} (idioma probable: ${input.languageHint})`
        : TRANSCRIBE_PROMPT;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: input.mimeType.split(";")[0]?.trim() || input.mimeType,
                    data: input.audio.toString("base64"),
                  },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini transcription failed: ${res.status} ${body.slice(0, 300)}`);
      }

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        modelVersion?: string;
      };
      const text =
        json.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? "")
          .join("")
          .trim() ?? "";
      if (!text) throw new Error("Gemini returned an empty transcription");

      return {
        text,
        model: json.modelVersion ?? transcribeModel,
        promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      };
    },
  };
}

/** Built from env by lib/ai/index.ts; exported separately for tests. */
export function geminiDriverFromEnv(): AiDriver | null {
  if (!env.GEMINI_API_KEY) return null;
  return createGeminiDriver(
    env.GEMINI_API_KEY,
    env.AI_MODEL ?? DEFAULT_MODEL,
    env.AI_BASE_URL ?? DEFAULT_BASE_URL,
    env.AI_TRANSCRIBE_MODEL ?? env.AI_MODEL ?? DEFAULT_TRANSCRIBE_MODEL,
  );
}
