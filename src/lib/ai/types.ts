// Provider-neutral AI interface (PLAN.md §10 1O). Deliberately tiny — a
// prompt in, a string out — so swapping providers is a config change rather
// than a rewrite. Anything provider-specific (endpoints, request shape,
// token accounting field names) is confined to the driver files next to
// this one, exactly like lib/storage.

import type { z } from "zod";

export type AiProvider = "openai" | "gemini";

export type AiTurn = { role: "user" | "assistant"; content: string };

export type AiGenerateInput = {
  /** Business context + guardrails; never contains customer content. */
  system: string;
  /** Conversation so far, oldest first. */
  messages: AiTurn[];
  maxOutputTokens?: number;
};

export type AiGenerateResult = {
  text: string;
  model: string;
  /** Metered per tenant (§10 1O "cost is per-token and per-tenant"). */
  promptTokens: number;
  completionTokens: number;
};

/**
 * A call that must come back as data (PLAN.md §16.5 step 3). The schema is
 * the contract in both directions: it is sent to the provider as its
 * JSON-mode schema *and* it is what the answer is validated against, so a
 * provider that ignores the hint still cannot return something the caller
 * did not ask for.
 */
export type AiStructuredInput<T> = {
  system: string;
  messages: AiTurn[];
  schema: z.ZodType<T>;
  /** Required by OpenAI's json_schema response format; ignored elsewhere. */
  schemaName?: string;
  maxOutputTokens?: number;
};

export type AiStructuredResult<T> = {
  data: T;
  /** Exactly what the provider returned, for the ledger's prompt/response audit. */
  raw: string;
  model: string;
  /** Summed across attempts — a retry is billed too. */
  promptTokens: number;
  completionTokens: number;
  attempts: number;
};

export interface AiDriver {
  readonly provider: AiProvider;
  readonly model: string;
  generateReply(input: AiGenerateInput): Promise<AiGenerateResult>;
  generateStructured<T>(input: AiStructuredInput<T>): Promise<AiStructuredResult<T>>;
}

/** Shared ceiling — a WhatsApp reply that runs long is a bug, not a feature. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 400;

/**
 * Structured calls get their own, much larger ceiling: a setup plan is five
 * pipeline stages, a handful of flows and the widget copy, and truncating it
 * mid-object costs a whole retry.
 */
export const DEFAULT_MAX_STRUCTURED_OUTPUT_TOKENS = 4000;
