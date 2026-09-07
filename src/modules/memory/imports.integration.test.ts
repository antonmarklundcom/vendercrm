import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Memory imports end to end (K3, PLAN.md §16.3): a source (text, PDF, URL)
// turns into candidate facts, unconfirmed, via one mocked-driver
// `generateStructured` call — the exit criterion's "paste a sample FAQ
// text → 5 suggested facts". Needs a real MySQL, like every other
// DB-backed suite here.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("memory imports (MySQL integration)", () => {
  type TenantContext = import("@/modules/tenancy/context").TenantContext;
  let newId: (typeof import("@/lib/ids"))["newId"];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("@/lib/ai");
  });

  afterAll(async () => {
    const { db } = await import("@/db/client");
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  async function freshTenant(): Promise<TenantContext> {
    if (!newId) ({ newId } = await import("@/lib/ids"));
    const { createTenant } = await import("@/modules/tenancy/tenants");
    const superadmin = { userId: "sa-imports", impersonatorUserId: null } as const;
    const slug = `imports-${newId().toLowerCase()}`;
    const tenant = await createTenant(superadmin, { name: `Imports ${newId()}`, slug });
    return {
      tenantId: tenant!.id,
      userId: "admin-user",
      role: "admin",
      impersonatorUserId: null,
      accessStatus: "active",
    };
  }

  const CANDIDATE_FACTS = {
    facts: [
      { kind: "faq", title: "¿Hacen envíos?", body: "Sí, a todo el país." },
      { kind: "faq", title: "¿Aceptan tarjeta?", body: "Sí, débito y crédito." },
      { kind: "service", title: "Corte de pelo", body: "30 minutos, desde 50.000 Gs." },
      { kind: "policy", title: "Cancelación", body: "Hasta 24h antes, sin cargo." },
      { kind: "location", title: "Horario", body: "Lunes a sábado, 8 a 18." },
    ],
  };

  function mockDriver(data: unknown) {
    vi.doMock("@/lib/ai", () => ({
      getAiDriver: () => ({
        provider: "openai",
        model: "stub-model",
        generateReply: vi.fn(),
        generateStructured: vi.fn().mockResolvedValue({
          data,
          raw: JSON.stringify(data),
          model: "stub-model",
          promptTokens: 10,
          completionTokens: 20,
          attempts: 1,
        }),
        transcribeAudio: vi.fn(),
      }),
    }));
  }

  it("extracts 5 suggested, unconfirmed facts from pasted text", async () => {
    const ctx = await freshTenant();
    mockDriver(CANDIDATE_FACTS);

    const { importFromText } = await import("./imports");
    const result = await importFromText(ctx, "Preguntas frecuentes de nuestra barbería...");
    expect(result).toEqual({ ok: true, importId: expect.any(String), extractedCount: 5 });

    const { listFacts } = await import("./facts");
    const facts = await listFacts(ctx, {});
    expect(facts).toHaveLength(5);
    expect(facts.every((f) => f.source === "ai_suggested")).toBe(true);
    expect(facts.every((f) => f.confirmedAt === null)).toBe(true);

    const { listMemoryImports } = await import("./imports");
    const [row] = await listMemoryImports(ctx);
    expect(row!.status).toBe("extracted");
    expect(row!.extractedCount).toBe(5);
    expect(row!.aiReplyId).toBeTruthy();
  });

  it("falls back cleanly when no AI driver is configured, marking the import failed", async () => {
    vi.doMock("@/lib/ai", () => ({ getAiDriver: () => null }));
    const ctx = await freshTenant();
    const { importFromText, listMemoryImports } = await import("./imports");

    const result = await importFromText(ctx, "algo de texto");
    expect(result).toEqual({ ok: false, reason: "ai_unavailable" });

    const [row] = await listMemoryImports(ctx);
    expect(row!.status).toBe("failed");
    expect(row!.error).toBe("ai_unavailable");
  });

  it("rejects an empty paste before ever calling the driver", async () => {
    const ctx = await freshTenant();
    const { importFromText, listMemoryImports } = await import("./imports");

    const result = await importFromText(ctx, "   ");
    expect(result).toEqual({ ok: false, reason: "no_text" });

    const [row] = await listMemoryImports(ctx);
    expect(row!.status).toBe("failed");
  });

  it("extracts from a fetched URL, and confirming one suggested fact via the existing confirm path works", async () => {
    const ctx = await freshTenant();
    mockDriver({ facts: [{ kind: "faq", title: "¿Dónde están?", body: "En el centro." }] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body><p>¿Dónde están? En el centro.</p></body></html>", { status: 200 })),
    );

    const { importFromUrl } = await import("./imports");
    const result = await importFromUrl(ctx, "https://example.com/faq");
    expect(result).toEqual({ ok: true, importId: expect.any(String), extractedCount: 1 });

    const { listFacts, confirmFact } = await import("./facts");
    const [fact] = await listFacts(ctx, { kind: "faq" });
    expect(fact!.confirmedAt).toBeNull();

    await confirmFact(ctx, fact!.id, "admin-user");
    const [confirmed] = await listFacts(ctx, { kind: "faq" });
    expect(confirmed!.confirmedAt).not.toBeNull();

    vi.unstubAllGlobals();
  });

  it("imports a real PDF's text layer end to end", async () => {
    const ctx = await freshTenant();
    mockDriver({ facts: [{ kind: "note", title: "Nota del PDF", body: "Contenido de prueba" }] });

    const React = (await import("react")).default;
    const { Document, Page, Text, renderToBuffer } = await import("@react-pdf/renderer");
    const pdfBuffer = await renderToBuffer(
      React.createElement(
        Document,
        null,
        React.createElement(Page, null, React.createElement(Text, null, "Contenido de prueba")),
      ),
    );

    const { storage } = await import("@/lib/storage");
    const key = `memory-imports/${ctx.tenantId}/test.pdf`;
    await storage.put(key, pdfBuffer, "application/pdf");

    const { importFromPdf } = await import("./imports");
    const result = await importFromPdf(ctx, key);
    expect(result).toEqual({ ok: true, importId: expect.any(String), extractedCount: 1 });
  });
});
