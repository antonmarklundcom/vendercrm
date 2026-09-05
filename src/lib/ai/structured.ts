import { z } from "zod";
import type { AiGenerateResult, AiStructuredInput, AiStructuredResult } from "./types";

// JSON-mode generation (PLAN.md §16.2 rule 3, §16.5 step 3): the setup
// assistant's plan and the memory extractor need *data*, not prose, and the
// data has to satisfy a zod schema the rest of the app already validates
// with. Everything provider-neutral about that lives here — the drivers only
// know how to ask their own API for JSON.
//
// One retry, with the validation error appended. Not two: a model that fails
// its own schema twice is failing for a reason a third call will not fix,
// and every attempt is billed to the tenant.

export const MAX_STRUCTURED_ATTEMPTS = 2;

/** A single provider call in JSON mode. `repair` is null on the first try. */
export type StructuredCall = (repair: string | null) => Promise<AiGenerateResult>;

export async function runStructured<T>(
  input: AiStructuredInput<T>,
  call: StructuredCall,
): Promise<AiStructuredResult<T>> {
  let repair: string | null = null;
  let lastError = "";
  let promptTokens = 0;
  let completionTokens = 0;

  for (let attempt = 1; attempt <= MAX_STRUCTURED_ATTEMPTS; attempt++) {
    const raw = await call(repair);
    // Tokens accumulate across attempts: the tenant paid for both.
    promptTokens += raw.promptTokens;
    completionTokens += raw.completionTokens;

    const parsed = parseJson(raw.text);
    if (parsed.ok) {
      const validated = input.schema.safeParse(parsed.value);
      if (validated.success) {
        return {
          data: validated.data,
          raw: raw.text,
          model: raw.model,
          promptTokens,
          completionTokens,
          attempts: attempt,
        };
      }
      lastError = formatIssues(validated.error);
    } else {
      lastError = parsed.error;
    }

    repair =
      `Tu respuesta anterior no cumple el formato pedido. Error: ${lastError}. ` +
      "Respondé de nuevo con JSON válido y nada más, sin texto alrededor.";
  }

  throw new Error(`Structured generation failed validation: ${lastError}`);
}

/**
 * Models wrap JSON in ```json fences even when told not to, and even in JSON
 * mode when the mode is unsupported for that model. Stripping is cheaper
 * than a retry.
 */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid JSON" };
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * The zod schema as JSON Schema, for providers that take one. Draft-7 rather
 * than the 2020-12 default because both providers document their support in
 * those terms.
 */
export function toJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-7", io: "output" }) as Record<string, unknown>;
}

const GEMINI_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
  "anyOf",
  "propertyOrdering",
]);

/**
 * Gemini's `responseSchema` is an OpenAPI subset: it rejects `$schema`,
 * `additionalProperties` and the rest of JSON Schema outright rather than
 * ignoring them, so the schema is filtered down to what it accepts.
 */
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return prune(schema) as Record<string, unknown>;
}

function prune(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(prune);
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!GEMINI_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      const properties: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        properties[name] = prune(child);
      }
      out.properties = properties;
      continue;
    }
    out[key] = prune(value);
  }
  return out;
}
