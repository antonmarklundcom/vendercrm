import { describe, expect, it } from "vitest";
import { createGeminiDriver } from "./gemini";
import { createOpenAiDriver } from "./openai";
import { messageText, toTurns } from "./prompt";

// Voice-note transcription behind the driver seam (PLAN.md §15.3 Lane A,
// §15.10 W1). The drivers are tested against a stubbed fetch — the request
// shape is the only part of them that is theirs rather than the provider's.

/** Swaps global fetch, capturing the raw init so a multipart body can be
 *  inspected without JSON.parse choking on it. */
async function withFetch<T>(
  impl: () => Response,
  fn: () => Promise<T>,
): Promise<{ result: T; calls: Array<{ url: string; init: RequestInit }> }> {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return impl();
  }) as unknown as typeof fetch;
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

const AUDIO = Buffer.from("fake-opus-bytes");

describe("openai transcription", () => {
  it("posts the audio as multipart and returns the text", async () => {
    const driver = createOpenAiDriver("sk-test", "gpt-4o-mini", "https://example.test/v1", "whisper-x");
    const { result, calls } = await withFetch(
      () => new Response(JSON.stringify({ text: "  hola, quiero un presupuesto  " }), { status: 200 }),
      () =>
        driver.transcribeAudio({
          audio: AUDIO,
          mimeType: "audio/ogg; codecs=opus",
          languageHint: "es",
        }),
    );

    expect(result.text).toBe("hola, quiero un presupuesto");
    expect(result.model).toBe("whisper-x");
    expect(calls[0].url).toBe("https://example.test/v1/audio/transcriptions");

    const form = calls[0].init.body as FormData;
    expect(form.get("model")).toBe("whisper-x");
    expect(form.get("language")).toBe("es");
    const file = form.get("file") as File;
    // The extension matters: the API rejects an unrecognised filename even
    // when the part carries the right mime type.
    expect(file.name).toBe("audio.ogg");
  });

  it("throws on a non-2xx so the job retries and the row records why", async () => {
    const driver = createOpenAiDriver("sk-test");
    await expect(
      withFetch(
        () => new Response("service unavailable", { status: 503 }),
        () => driver.transcribeAudio({ audio: AUDIO, mimeType: "audio/ogg" }),
      ),
    ).rejects.toThrow(/503/);
  });

  it("treats an empty transcription as a failure rather than an empty message", async () => {
    const driver = createOpenAiDriver("sk-test");
    await expect(
      withFetch(
        () => new Response(JSON.stringify({ text: "   " }), { status: 200 }),
        () => driver.transcribeAudio({ audio: AUDIO, mimeType: "audio/ogg" }),
      ),
    ).rejects.toThrow(/empty/i);
  });
});

describe("gemini transcription", () => {
  it("sends the audio inline and reads usageMetadata", async () => {
    const driver = createGeminiDriver("key", "gemini-2.0-flash", "https://g.test/v1beta");
    const { result, calls } = await withFetch(
      () =>
        new Response(
          JSON.stringify({
            modelVersion: "gemini-2.0-flash-001",
            candidates: [{ content: { parts: [{ text: "necesito una visita" }] } }],
            usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 12 },
          }),
          { status: 200 },
        ),
      () => driver.transcribeAudio({ audio: AUDIO, mimeType: "audio/ogg; codecs=opus" }),
    );

    expect(result.text).toBe("necesito una visita");
    expect(result.model).toBe("gemini-2.0-flash-001");
    expect(result.promptTokens).toBe(300);
    expect(result.completionTokens).toBe(12);

    const body = JSON.parse(String(calls[0].init.body)) as {
      contents: Array<{ parts: Array<{ inline_data?: { mime_type: string; data: string } }> }>;
    };
    const inline = body.contents[0].parts[1].inline_data!;
    // The codecs parameter is stripped: Google rejects the full header.
    expect(inline.mime_type).toBe("audio/ogg");
    expect(Buffer.from(inline.data, "base64").toString()).toBe("fake-opus-bytes");
  });
});

describe("transcripts in the prompt", () => {
  it("a done transcript is what the model sees for an audio message", () => {
    expect(
      messageText({
        direction: "in",
        body: null,
        transcript: "quiero agendar",
        transcriptStatus: "done",
      }),
    ).toBe("quiero agendar");
  });

  it("a pending transcript contributes nothing — the reply waits for it", () => {
    expect(
      messageText({ direction: "in", body: null, transcript: null, transcriptStatus: "pending" }),
    ).toBe("");

    const turns = toTurns([
      { direction: "in", body: "hola", transcript: null, transcriptStatus: null },
      { direction: "in", body: null, transcript: null, transcriptStatus: "pending" },
    ]);
    expect(turns).toEqual([{ role: "user", content: "hola" }]);
  });

  it("a failed transcript never leaks its reason into the conversation", () => {
    expect(
      messageText({
        direction: "in",
        body: null,
        transcript: null,
        transcriptStatus: "failed",
      }),
    ).toBe("");
  });
});
