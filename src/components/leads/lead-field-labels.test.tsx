import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import es from "../../../messages/es.json";
import { buildLeadSubmissionView, type LeadFieldSiteSettings } from "@/modules/leads/view";
import { LeadSubmissionCard, buildLeadCardLabels } from "./lead-submission-card";

// L3 (PLAN.md §19.2): what the label editor saves in `sites.settings` is what
// the existing card shows — for any lead, old or new — and a label is only
// ever text.

vi.mock("@/app/(app)/sites/actions", () => ({ saveSiteFieldLabelsAction: vi.fn() }));
const { SiteFieldLabelsForm } = await import("@/app/(app)/sites/SiteFieldLabelsForm");

const labels = buildLeadCardLabels(
  (key) => (es.app.leadData as unknown as Record<string, string>)[key],
);
const fieldNames = es.app.leadData.fieldNames as Record<string, string>;

function render(siteSettings: LeadFieldSiteSettings | undefined) {
  const view = buildLeadSubmissionView(
    {
      id: "s1",
      createdAt: new Date("2026-10-01T12:00:00Z"),
      payload: { finalidad: "Venta", ciudad: "Lambaré", tipo_de_propiedad: "Casa", campo_nuevo: "x1" },
      utm: {},
      notes: "Quiero tasar",
      pageUrl: null,
      referrer: null,
      dealId: null,
    },
    {
      origin: { kind: "site", name: "Tasación", domain: "tasacion.com.py" },
      contact: null,
      fieldNames,
      siteSettings,
    },
  );
  return renderToStaticMarkup(createElement(LeadSubmissionCard, { view, labels, locale: "es" }));
}

describe("saved field labels on the lead card", () => {
  it("shows the saved labels and prominent flags, and keeps auto labels for other keys", () => {
    const html = render({
      fieldLabels: { tipo_de_propiedad: "Tipo de inmueble", ciudad: "Ciudad del inmueble" },
      fieldDisplay: { finalidad: { prominent: true }, ciudad: { prominent: true }, message: { prominent: true } },
    });
    expect(html).toContain("Tipo de inmueble");
    expect(html).toContain("Ciudad del inmueble");
    expect(html).not.toContain("Tipo de propiedad");
    // Prominent block uses the large type size and comes before regular rows.
    expect(html).toContain("text-lg font-semibold");
    expect(html.indexOf("Ciudad del inmueble")).toBeLessThan(html.indexOf("Tipo de inmueble"));
    expect(html.indexOf("Finalidad")).toBeLessThan(html.indexOf("Tipo de inmueble"));
    // Never configured: still there, with the humanized key.
    expect(html).toContain("Campo nuevo");
    expect(html).toContain("x1");
    expect(html).toContain("Quiero tasar");
  });

  it("keeps the auto label of a key that was never configured", () => {
    const html = render({ fieldLabels: { ciudad: "Ciudad del inmueble" } });
    expect(html).toContain("Tipo de propiedad");
    expect(html).toContain("Finalidad");
    expect(html).not.toContain("text-lg font-semibold");
  });

  it("renders a label containing HTML as plain text", () => {
    const evil = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
    const html = render({ fieldLabels: { finalidad: evil }, fieldDisplay: { finalidad: { prominent: true } } });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("SiteFieldLabelsForm", () => {
  const panelLabels = {
    title: "Campos",
    intro: "intro",
    empty: "vacío",
    key: "Campo",
    label: "Nombre",
    prominent: "Destacar",
    save: "Guardar",
    saved: "ok",
    messageKey: "mensaje",
    errors: { unknown: "error" },
  };

  it("renders stored HTML labels escaped, never as markup", () => {
    const evil = `"><script>alert(1)</script>`;
    const html = renderToStaticMarkup(
      createElement(SiteFieldLabelsForm, {
        siteId: "site1",
        rows: [{ key: "ciudad", label: evil, prominent: true, autoLabel: "Ciudad" }],
        labels: panelLabels,
        maxLength: 80,
      }),
    );
    // (React appends its own form-replay <script>; only the label must not be markup.)
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)");
    expect(html).toContain('placeholder="Ciudad"');
    expect(html).toContain('maxLength="80"');
  });
});
