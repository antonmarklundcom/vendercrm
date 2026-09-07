import { eq } from "drizzle-orm";
import { z } from "zod";
import { memoryImports } from "@/db/schema";
import { newId } from "@/lib/ids";
import { storage } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAiDriver } from "@/lib/ai";
import type { TenantContext } from "@/modules/tenancy/context";
import { tenantDb } from "@/modules/tenancy/db";
import { getAiConfig } from "@/modules/ai/config";
import { countRepliesTodayForTenant, recordReply } from "@/modules/ai/replies";
import { createFact, FACT_KINDS } from "./facts";
import { htmlToText } from "./html-to-text";

// Memory imports (K3, PLAN.md §16.3, §16.5's sibling for content the tenant
// already has written down somewhere else): paste text, upload a PDF, or
// give a URL; one `generateStructured` call turns it into candidate facts,
// written `source: ai_suggested` — unconfirmed until an admin reviews them
// on `/settings/negocio`, which already has that review UI (K1). This file
// is only the getting-from-source-to-candidate-facts half.

export type MemoryImportRow = typeof memoryImports.$inferSelect;

const URL_FETCH_MAX_BYTES = 200_000;
const URL_FETCH_TIMEOUT_MS = 10_000;
/** Per tenant: an import is an admin action, not a public endpoint, but a
 *  URL fetch still reaches out to the internet on the tenant's behalf. */
const URL_FETCH_LIMIT = 10;
const URL_FETCH_WINDOW_MS = 60 * 60_000;

export async function listMemoryImports(ctx: TenantContext): Promise<MemoryImportRow[]> {
  const rows = await tenantDb(ctx).select(memoryImports);
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

async function createImportRow(
  ctx: TenantContext,
  sourceKind: "text" | "pdf" | "url",
  sourceRef: string | null,
): Promise<MemoryImportRow> {
  const id = newId();
  await tenantDb(ctx)
    .insert(memoryImports)
    .values({ id, sourceKind, sourceRef, status: "pending", createdBy: ctx.userId });
  const [row] = await tenantDb(ctx).select(memoryImports, eq(memoryImports.id, id));
  return row!;
}

async function markFailed(ctx: TenantContext, id: string, error: string): Promise<void> {
  await tenantDb(ctx)
    .update(memoryImports)
    .set({ status: "failed", error: error.slice(0, 2000), updatedAt: new Date() })
    .where(eq(memoryImports.id, id));
}

export type ImportResult =
  | { ok: true; importId: string; extractedCount: number }
  | { ok: false; reason: "ai_unavailable" | "daily_cap_reached" | "extraction_failed" | "no_text" | "fetch_failed" | "pdf_no_text_layer" };

/** Pasted text — the simplest source, and the one every other source ends
 *  up as before extraction runs. */
export async function importFromText(ctx: TenantContext, text: string): Promise<ImportResult> {
  const row = await createImportRow(ctx, "text", null);
  return extractFacts(ctx, row, text);
}

/** A PDF already uploaded to the storage driver under `key` (the caller's
 *  upload route did that part — this is extraction only). A PDF with no
 *  text layer (a scan) is reported as such, never OCR'd (§16.5-adjacent
 *  rule: this phase adds no OCR dependency). */
export async function importFromPdf(ctx: TenantContext, key: string): Promise<ImportResult> {
  const row = await createImportRow(ctx, "pdf", key);
  try {
    const buffer = await storage.get(key);
    const text = (await extractPdfText(buffer)).trim();
    if (!text) {
      await markFailed(ctx, row.id, "pdf_no_text_layer");
      return { ok: false, reason: "pdf_no_text_layer" };
    }
    return extractFacts(ctx, row, text);
  } catch (error) {
    await markFailed(ctx, row.id, String(error));
    return { ok: false, reason: "extraction_failed" };
  }
}

/** `pdfjs-dist`'s own text layer reader — no rendering, no canvas, just the
 *  text runs per page. Mozilla's actively maintained engine; the older
 *  `pdf-parse` package bundles a years-stale pdf.js that rejects PDFs from
 *  perfectly ordinary modern writers (react-pdf's own output included) with
 *  a "bad XRef entry" error. */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n");
}

/** A same-tenant rate limit, a 200 KB cap on the response, and a crude
 *  HTML-to-text (script/style stripped, tags dropped) — enough for a
 *  services or FAQ page, not a general scraper. */
export async function importFromUrl(ctx: TenantContext, url: string): Promise<ImportResult> {
  const row = await createImportRow(ctx, "url", url);

  const limited = await checkRateLimit(`memory-import:${ctx.tenantId}`, URL_FETCH_LIMIT, URL_FETCH_WINDOW_MS);
  if (limited.limited) {
    await markFailed(ctx, row.id, "rate_limited");
    return { ok: false, reason: "fetch_failed" };
  }

  let html: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    html = buffer.subarray(0, URL_FETCH_MAX_BYTES).toString("utf-8");
  } catch (error) {
    await markFailed(ctx, row.id, String(error));
    return { ok: false, reason: "fetch_failed" };
  }

  const text = htmlToText(html).trim();
  if (!text) {
    await markFailed(ctx, row.id, "no_text");
    return { ok: false, reason: "no_text" };
  }
  return extractFacts(ctx, row, text);
}

const EXTRACT_SCHEMA = z.object({
  facts: z
    .array(
      z.object({
        kind: z.enum(FACT_KINDS),
        title: z.string().trim().min(1).max(300),
        body: z.string().trim().max(5000).nullable().optional(),
      }),
    )
    .max(20),
});

const EXTRACT_SYSTEM_PROMPT = `Sos un asistente que lee texto de un negocio (una web, un PDF, notas pegadas) y
extrae hechos puntuales para la memoria de un CRM: preguntas frecuentes (faq), servicios y precios (service),
políticas de cancelación/seña/pago (policy), horario y dirección (location), formas de contacto (contact),
promociones (promo), u otra nota (note). Respondé solo con el JSON pedido. No inventes nada que no esté en el
texto — si el texto no tiene datos claros, devolvé una lista vacía.`;

/**
 * One structured call, the source text as input, up to 20 candidate facts
 * as output — each written unconfirmed (§16.2 rule 2) so nothing the model
 * read becomes visible to a customer until an admin has looked at it.
 * Never throws: an AI failure or the tenant's daily cap ends the import as
 * `failed` with a reason, the same discipline the setup assistant's plan
 * generation follows (K2).
 */
async function extractFacts(ctx: TenantContext, row: MemoryImportRow, text: string): Promise<ImportResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    await markFailed(ctx, row.id, "no_text");
    return { ok: false, reason: "no_text" };
  }

  const driver = getAiDriver();
  if (!driver) {
    await markFailed(ctx, row.id, "ai_unavailable");
    return { ok: false, reason: "ai_unavailable" };
  }

  const config = await getAiConfig(ctx);
  const usedToday = await countRepliesTodayForTenant(ctx);
  if (usedToday >= config.maxRepliesPerTenantPerDay) {
    await markFailed(ctx, row.id, "daily_cap_reached");
    return { ok: false, reason: "daily_cap_reached" };
  }

  try {
    const result = await driver.generateStructured({
      system: EXTRACT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: trimmed.slice(0, 20_000) }],
      schema: EXTRACT_SCHEMA,
      schemaName: "memory_extract",
    });

    const reply = await recordReply(ctx, {
      kind: "memory_extract",
      mode: "send",
      status: "sent",
      prompt: `${EXTRACT_SYSTEM_PROMPT}\n\n${trimmed.slice(0, 20_000)}`,
      body: result.raw,
      provider: driver.provider,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });

    for (const fact of result.data.facts) {
      await createFact(
        ctx,
        {
          kind: fact.kind,
          title: fact.title,
          body: fact.body ?? null,
          visibility: "customer",
        },
        { source: "ai_suggested" },
      );
    }

    await tenantDb(ctx)
      .update(memoryImports)
      .set({
        status: "extracted",
        extractedCount: result.data.facts.length,
        aiReplyId: reply?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(memoryImports.id, row.id));

    return { ok: true, importId: row.id, extractedCount: result.data.facts.length };
  } catch (error) {
    await recordReply(ctx, {
      kind: "memory_extract",
      mode: "send",
      status: "failed",
      prompt: `${EXTRACT_SYSTEM_PROMPT}\n\n${trimmed.slice(0, 20_000)}`,
      body: "",
      provider: driver.provider,
      model: "",
      promptTokens: 0,
      completionTokens: 0,
      error: "memory_extraction_failed",
    });
    await markFailed(ctx, row.id, String(error));
    return { ok: false, reason: "extraction_failed" };
  }
}
