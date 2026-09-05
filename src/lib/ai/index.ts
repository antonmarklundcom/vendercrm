import { env } from "@/lib/config/env";
import { openAiDriverFromEnv } from "./openai";
import { geminiDriverFromEnv } from "./gemini";
import type { AiDriver } from "./types";

export type {
  AiDriver,
  AiGenerateInput,
  AiGenerateResult,
  AiProvider,
  AiStructuredInput,
  AiStructuredResult,
  AiTurn,
} from "./types";
export { DEFAULT_MAX_STRUCTURED_OUTPUT_TOKENS } from "./types";
export { MAX_STRUCTURED_ATTEMPTS, parseJson, toGeminiSchema, toJsonSchema } from "./structured";
export {
  buildReplyPrompt,
  buildSystemPrompt,
  extractBookingIntent,
  serialisePrompt,
  toTurns,
} from "./prompt";
export type { BookingIntent, BusinessContext } from "./prompt";

// Driver selection by env (PLAN.md §10 1O), same shape as lib/storage —
// with one deliberate difference: storage always resolves to *some* adapter
// because every deployment must be able to store a file, whereas AI is
// opt-in. `AI_DRIVER=none` (the default) returns null, and the ai_reply
// action node treats that as a skip-with-reason rather than a failure.

function resolveAi(): AiDriver | null {
  switch (env.AI_DRIVER) {
    case "none":
      return null;
    case "openai":
      return openAiDriverFromEnv();
    case "gemini":
      return geminiDriverFromEnv();
  }
}

let cached: AiDriver | null | undefined;

export function getAiDriver(): AiDriver | null {
  if (cached === undefined) cached = resolveAi();
  return cached;
}

export function isAiConfigured(): boolean {
  return getAiDriver() !== null;
}
