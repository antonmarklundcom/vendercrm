import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import es from "../../../../messages/es.json";
import type { PlatformContactRow, PlatformDealRow, PlatformLeadRow } from "@/modules/tenancy/platform-crm";
import {
  buildPlatformLeadsLabels,
  ContactsTable,
  DealsTable,
  LeadsTable,
} from "./platform-leads-tables";

// Resolves "columns.received" against the es dictionary; ICU params are
// substituted by hand, which is all the one parameterised key needs.
const dictionary = es.superadmin.platformLeads as unknown as Record<string, unknown>;
const labels = buildPlatformLeadsLabels((key, values) => {
  const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dictionary);
  return Object.entries(values ?? {}).reduce((out, [name, value]) => out.replace(`{${name}}`, String(value)), text as string);
});

const lead = (overrides: Partial<PlatformLeadRow> = {}): PlatformLeadRow => ({
  id: "s1",
  tenantId: "01HZZZZZZZZZZZZZZZZZZZZZZA",
  tenantName: "Tasación A",
  tenantStatus: "active",
  receivedAt: new Date("2026-09-30T15:00:00Z"),
  needsReview: [],
  origin: { kind: "site", name: "Tasación", domain: "tasacion.com.py" },
  contactId: "c1",
  name: "María Benítez",
  phone: "+595981123456",
  email: "maria@example.com",
  message: "Quiero tasar mi casa",
  fields: [
    { key: "finalidad", value: "Venta" },
    { key: "ciudad", value: "Asunción" },
  ],
  utmSource: "google",
  utmCampaign: "tasacion",
  dealId: "01HZZZZZZZZZZZZZZZZZZZZZZD",
  dealStatus: "open",
  stageName: "Nuevo",
  ...overrides,
});

const html = (rows: PlatformLeadRow[]) =>
  renderToStaticMarkup(createElement(LeadsTable, { rows, labels, locale: "es" }));

describe("LeadsTable", () => {
  it("shows the Revisar badge for a row whose needsReview is non-empty, with the codes", () => {
    const out = html([lead({ needsReview: ["email_invalid", "message_truncated"] })]);
    expect(out).toContain(">Revisar<");
    expect(out).toContain("email_invalid, message_truncated");
  });

  it("shows no badge on a clean row", () => {
    expect(html([lead()])).not.toContain("Revisar</span>");
  });

  it("badges only the rows that need it", () => {
    const out = html([lead({ id: "a", needsReview: ["email_invalid"] }), lead({ id: "b", name: "Otro" })]);
    expect(out.match(/>Revisar</g)).toHaveLength(1);
  });

  it("renders the account, its status chip, the first fields, utm and the open link", () => {
    const out = html([lead()]);
    expect(out).toContain("Tasación A");
    expect(out).toContain("Activa");
    expect(out).toContain("finalidad: Venta · ciudad: Asunción");
    expect(out).toContain("google / tasacion");
    expect(out).toContain("tasacion.com.py");
    expect(out).toContain('href="/platform-leads/01HZZZZZZZZZZZZZZZZZZZZZZA/deals/01HZZZZZZZZZZZZZZZZZZZZZZD"');
  });

  it("has no open link for a lead without a deal", () => {
    expect(html([lead({ dealId: null, dealStatus: null, stageName: null })])).not.toContain("/deals/");
  });

  it("scrolls the table inside its own container, never the page", () => {
    expect(html([lead()])).toMatch(/class="max-w-full overflow-x-auto[^"]*"><table/);
  });

  it("escapes what the public internet sent", () => {
    const out = html([
      lead({
        name: `<img src=x onerror=alert(1)>`,
        message: `<script>alert(1)</script>`,
        fields: [{ key: "<b>k</b>", value: `"><svg onload=alert(1)>` }],
      }),
    ]);
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<svg onload");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("DealsTable / ContactsTable", () => {
  it("renders a deal with its value in its own currency and a link to the detail", () => {
    const deal: PlatformDealRow = {
      id: "01HZZZZZZZZZZZZZZZZZZZZZZD",
      tenantId: "01HZZZZZZZZZZZZZZZZZZZZZZA",
      tenantName: "Tasación A",
      tenantStatus: "suspended",
      createdAt: new Date("2026-09-30T15:00:00Z"),
      title: "Tasación casa Lambaré",
      contactId: "c1",
      contactName: "María Benítez",
      contactPhone: "+595981123456",
      pipelineName: "Ventas",
      stageName: "Ganado",
      status: "won",
      value: 1500,
      currency: "USD",
      ownerName: null,
      source: "web",
      siteName: "Tasación",
      siteDomain: "tasacion.com.py",
      stageEnteredAt: new Date("2026-09-30T16:00:00Z"),
    };
    const out = renderToStaticMarkup(createElement(DealsTable, { rows: [deal], labels, locale: "es" }));
    expect(out).toContain("USD");
    expect(out).toContain("Suspendida");
    expect(out).toContain("Ganado");
    expect(out).toContain("/deals/01HZZZZZZZZZZZZZZZZZZZZZZD");
  });

  it("renders a contact row with an open link to its detail", () => {
    const contact: PlatformContactRow = {
      id: "c1",
      tenantId: "01HZZZZZZZZZZZZZZZZZZZZZZA",
      tenantName: "Tasación A",
      tenantStatus: "trial",
      createdAt: new Date("2026-09-30T15:00:00Z"),
      name: "María Benítez",
      phone: "+595981123456",
      email: null,
      source: "web",
      firstSiteName: null,
      firstSiteDomain: "tasacion.com.py",
      openDeals: 2,
    };
    const out = renderToStaticMarkup(createElement(ContactsTable, { rows: [contact], labels, locale: "es" }));
    expect(out).toContain("María Benítez");
    expect(out).toContain("Prueba");
    expect(out).not.toContain("/deals/");
    expect(out).toContain('href="/platform-leads/01HZZZZZZZZZZZZZZZZZZZZZZA/contacts/c1"');
  });

  it("escapes a contact's name and account", () => {
    const out = renderToStaticMarkup(
      createElement(ContactsTable, {
        rows: [
          {
            id: "c1",
            tenantId: "01HZZZZZZZZZZZZZZZZZZZZZZA",
            tenantName: "<script>x</script>",
            tenantStatus: "active",
            createdAt: new Date("2026-09-30T15:00:00Z"),
            name: "<img src=x onerror=alert(1)>",
            phone: "1",
            email: null,
            source: null,
            firstSiteName: null,
            firstSiteDomain: null,
            openDeals: 0,
          },
        ],
        labels,
        locale: "es",
      }),
    );
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<script>");
  });
});

describe("phone layout (cards below md)", () => {
  it("stacks every row as a card on phones and keeps the table from md up", () => {
    const out = html([lead({ needsReview: ["email_invalid"] })]);
    expect(out).toMatch(/<table class="block [^"]*md:table /);
    expect(out).toContain('<thead class="hidden md:table-header-group">');
    expect(out).toMatch(/<tr class="block [^"]*md:table-row /);
    // The Revisar badge and the open link stay on the card.
    expect(out).toContain(">Revisar<");
    expect(out).toMatch(/<td class="block [^"]*md:table-cell[^"]*"><a [^>]*href="\/platform-leads\/[^"]*\/deals\//);
    // Wide cells fall away on phones instead of scrolling the page.
    expect(out).toContain("hidden md:table-cell");
  });

  it("has no fixed minimum width below md", () => {
    for (const tag of [LeadsTable, DealsTable, ContactsTable]) {
      const out = renderToStaticMarkup(createElement(tag as never, { rows: [], labels, locale: "es" } as never));
      expect(out).not.toMatch(/[ "]min-w-\[/);
      expect(out).toContain("md:min-w-[");
    }
  });
});

describe("source hygiene", () => {
  it.each(["platform-leads-tables.tsx", "page.tsx", "[tenantId]/deals/[dealId]/page.tsx", "[tenantId]/contacts/[contactId]/page.tsx"])(
    "%s has no raw-HTML escape hatch",
    (file) => {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source).not.toContain("dangerouslySetInnerHTML");
    },
  );
});
