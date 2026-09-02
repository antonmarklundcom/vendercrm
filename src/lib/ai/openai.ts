import { env } from "@/lib/config/env";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  type AiDriver,
  type AiGenerateInput,
  type AiGenerateResult,
} from "./types";

// OpenAI driver (PLAN.md §10 1O). Plain `fetch` against the Chat Completions
// endpoint rather than the SDK: the surface used here is one POST, and not
// adding a dependency keeps the Hostinger bundle small (same reasoning as
// §2.3's @react-pdf/renderer choice over headless Chrome).

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
/** A model call that has not answered in a minute is not going to; release the process. */
const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = "gpt-4o-mini";

export function createOpenAiDriver(
  apiKey: string,
  model: string = DEFAULT_MODEL,
  baseUrl: string = DEFAULT_BASE_URL,
): AiDriver {
  return {
    provider: "openai",
    model,

    async generateReply(input: AiGenerateInput): Promise<AiGenerateResult> {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          messages: [
            { role: "system", content: input.system },
            ...input.messages.map((turn) => ({ role: turn.role, content: turn.content })),
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI request failed: ${res.status} ${body.slice(0, 300)}`);
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
    },
  };
}

/** Built from env by lib/ai/index.ts; exported separately for tests. */
export function openAiDriverFromEnv(): AiDriver | null {
  if (!env.OPENAI_API_KEY) return null;
  return createOpenAiDriver(
    env.OPENAI_API_KEY,
    env.AI_MODEL ?? DEFAULT_MODEL,
    env.AI_BASE_URL ?? DEFAULT_BASE_URL,
  );
}
