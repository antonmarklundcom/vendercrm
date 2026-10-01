import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import es from "../../../messages/es.json";
import { buildLeadSubmissionView, type LeadViewContext } from "@/modules/leads/view";
import { LeadSubmissionCard, buildLeadCardLabels, type LeadCardLabels } from "./lead-submission-card";

const labels: LeadCardLabels = buildLeadCardLabels(
  (key) => (es.app.leadData as unknown as Record<string, string>)[key],
);
const fieldNames = es.app.leadData.fieldNames as Record<string, string>;

// The body tasacion.com.py posts: finalidad/ciudad travel in `fields`, the
// rest at the top level of POST /api/v1/leads, plus one field nobody has
// ever mapped.
const TASACION = {
  name: "María Benítez",
  phone: "+595981123456",
  email: "maria@example.com",
  message: "Quiero tasar mi casa en Lambaré",
  page_url: "https://tasacion.com.py/tasar-casa?ref=home",
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "tasacion-asuncion",
  fields: {
    finalidad: "Venta",
    ciudad: "Lambaré",
    mensaje: "Consulta por escritura y deudas pendientes",
    superficie_aprox: "180 m2 de terreno",
  },
};

const baseContext: LeadViewContext = {
  origin: { kind: "site", name: "Tasación", domain: "tasacion.com.py" },
  contact: { name: TASACION.name, email: TASACION.email, phone: TASACION.phone },
  fieldNames,
};

function viewOf(payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return buildLeadSubmissionView(
    {
      id: "sub1",
      createdAt: new Date("2026-10-01T12:00:00Z"),
      payload,
      utm: { source: TASACION.utm_source, medium: TASACION.utm_medium, campaign: TASACION.utm_campaign },
      notes: TASACION.message,
      pageUrl: TASACION.page_url,
      referrer: null,
      dealId: "deal1",
      ...extra,
    },
    baseContext,
  );
}

const render = (view: ReturnType<typeof viewOf>) =>
  renderToStaticMarkup(createElement(LeadSubmissionCard, { view, labels, locale: "es" }));

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

describe("LeadSubmissionCard", () => {
  it("renders every submitted value of the tasacion payload and an unknown field", () => {
    const view = viewOf(TASACION.fields);
    const html = render(view);

    const submitted = [
      TASACION.name,
      TASACION.phone,
      TASACION.email,
      TASACION.message,
      TASACION.page_url,
      TASACION.utm_source,
      TASACION.utm_medium,
      TASACION.utm_campaign,
      ...Object.values(TASACION.fields),
    ];
    const missing = submitted.filter((value) => !html.includes(escapeHtml(value)));
    expect(missing).toEqual([]);

    // Dictionary label for a known key, humanized label for the unknown one.
    expect(html).toContain("Finalidad");
    expect(html).toContain("Superficie aprox");
    expect(html).toContain("tasacion.com.py");
  });

  it("renders a field added tomorrow with no code change", () => {
    const key = `campo_${Math.random().toString(36).slice(2, 8)}`;
    const html = render(viewOf({ ...TASACION.fields, [key]: "valor-nuevo-123" }));
    expect(html).toContain("valor-nuevo-123");
  });

  it("escapes markup in a value", () => {
    const html = render(viewOf({ ciudad: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not turn a javascript: page URL into a link", () => {
    const html = render(viewOf({}, { pageUrl: "javascript:alert(1)", referrer: "data:text/html,x" }));
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/href="data:/i);
    expect(html).toContain("javascript:alert(1)");
  });

  it("links an https page URL safely", () => {
    const html = render(viewOf({}));
    expect(html).toMatch(/href="https:\/\/tasacion\.com\.py\/tasar-casa\?ref=home"/);
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it("collapses a very long message behind a details element", () => {
    const long = "a".repeat(700);
    const html = render(viewOf({}, { notes: long }));
    expect(html).toContain("<details");
    expect(html).toContain(long);
  });

  it("shows prominent fields in the large block at the top", () => {
    const view = buildLeadSubmissionView(
      {
        id: "s",
        createdAt: new Date(),
        payload: { otro: "x", finalidad: "Venta" },
        utm: {},
        notes: null,
        pageUrl: null,
        referrer: null,
        dealId: null,
      },
      { ...baseContext, siteSettings: { fieldDisplay: { finalidad: { prominent: true } } } },
    );
    const html = render(view);
    expect(html).toContain("text-lg");
    expect(html.indexOf("Venta")).toBeLessThan(html.indexOf(">x<"));
  });

  it("shows the Revisar badge only when something was repaired", () => {
    const clean = render(viewOf({}));
    expect(clean).not.toContain(labels.review);
    const flagged = render({ ...viewOf({}), needsReview: ["email_invalid"] });
    expect(flagged).toContain(labels.review);
    expect(flagged).toContain("email_invalid");
  });

  it("never uses raw HTML injection", () => {
    const source = readFileSync(
      new URL("./lead-submission-card.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});
