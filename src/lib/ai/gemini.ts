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
} from "./types";

// Gemini driver (PLAN.md §10 1O). Same contract as the OpenAI one; the two
// differences Google's API forces are that the system prompt is its own
// `systemInstruction` field rather than a message, and that the assistant
// role is spelled `model`.

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
/** A model call that has not answered in a minute is not going to; release the process. */
const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = "gemini-2.0-flash";

export function createGeminiDriver(
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseUrl: string = DEFAULT_BASE_URL,
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
  };
}

/** Built from env by lib/ai/index.ts; exported separately for tests. */
export function geminiDriverFromEnv(): AiDriver | null {
  if (!env.GEMINI_API_KEY) return null;
  return createGeminiDriver(
    env.GEMINI_API_KEY,
    env.AI_MODEL ?? DEFAULT_MODEL,
    env.AI_BASE_URL ?? DEFAULT_BASE_URL,
  );
}
