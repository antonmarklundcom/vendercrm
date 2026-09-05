import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGeminiDriver } from "./gemini";
import { createOpenAiDriver } from "./openai";
import { parseJson, toGeminiSchema, toJsonSchema } from "./structured";

// JSON-mode generation (PLAN.md §16.2 rule 3). The drivers are exercised
// against a stubbed fetch — the same shape lib/ai/ai.test.ts uses — because
// the only part of them that is not pure is the request they build.

const planSchema = z.object({
  stages: z.array(z.string()).min(1),
  aiMode: z.literal("draft"),
});

function stubFetch(...responses: Array<{ content: string }>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let index = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, body });
    const response = responses[Math.min(index++, responses.length - 1)];
    return {
      ok: true,
      json: async () => ({
        // OpenAI shape and Gemini shape at once: each driver reads its own
        // half and ignores the other, which keeps this stub to one function.
        choices: [{ message: { content: response.content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        model: "stub-model",
        candidates: [{ content: { parts: [{ text: response.content }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        modelVersion: "stub-model",
      }),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseJson", () => {
  it("survives the code fence models add even when told not to", () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJson("no soy JSON").ok).toBe(false);
  });
});

describe("toGeminiSchema", () => {
  it("drops the keywords Google's responseSchema rejects", () => {
    const schema = toGeminiSchema(toJsonSchema(planSchema));
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBeUndefined();
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties as Record<string, unknown>)).toEqual([
      "stages",
      "aiMode",
    ]);
  });
});

describe("generateStructured", () => {
  it("validates the answer against the zod schema and returns typed data", async () => {
    const calls = stubFetch({ content: '{"stages":["Nuevo","Ganado"],"aiMode":"draft"}' });
    const driver = createOpenAiDriver("key", "gpt-test", "https://example.test/v1");

    const result = await driver.generateStructured({
      system: "sos un configurador",
      messages: [{ role: "user", content: "configurá una barbería" }],
      schema: planSchema,
      schemaName: "plan",
    });

    expect(result.data.stages).toEqual(["Nuevo", "Ganado"]);
    expect(result.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    const format = calls[0].body.response_format as { type: string; json_schema: { name: string } };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.name).toBe("plan");
  });

  it("retries once with the validation error appended, and keeps the second answer", async () => {
    const calls = stubFetch(
      { content: '{"stages":[],"aiMode":"send"}' },
      { content: '{"stages":["Nuevo"],"aiMode":"draft"}' },
    );
    const driver = createOpenAiDriver("key", "gpt-test", "https://example.test/v1");

    const result = await driver.generateStructured({
      system: "sos un configurador",
      messages: [],
      schema: planSchema,
    });

    expect(result.attempts).toBe(2);
    expect(result.data.stages).toEqual(["Nuevo"]);
    // Both attempts are billed to the tenant, so both are counted.
    expect(result.promptTokens).toBe(20);
    const second = calls[1].body.messages as Array<{ role: string; content: string }>;
    expect(second[0].content).toContain("no cumple el formato");
  });

  it("throws rather than returning something the schema never allowed", async () => {
    const calls = stubFetch({ content: '{"stages":[],"aiMode":"send"}' });
    const driver = createOpenAiDriver("key", "gpt-test", "https://example.test/v1");

    await expect(
      driver.generateStructured({ system: "x", messages: [], schema: planSchema }),
    ).rejects.toThrow(/failed validation/);
    // Two attempts and no more: a third call is more spend for the same answer.
    expect(calls).toHaveLength(2);
  });

  it("asks Gemini for JSON with a pruned responseSchema", async () => {
    const calls = stubFetch({ content: '{"stages":["Nuevo"],"aiMode":"draft"}' });
    const driver = createGeminiDriver("key", "gemini-test", "https://example.test/v1beta");

    await driver.generateStructured({ system: "x", messages: [], schema: planSchema });

    const config = calls[0].body.generationConfig as {
      responseMimeType: string;
      responseSchema: Record<string, unknown>;
    };
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseSchema.$schema).toBeUndefined();
    expect(config.responseSchema.type).toBe("object");
  });
});
