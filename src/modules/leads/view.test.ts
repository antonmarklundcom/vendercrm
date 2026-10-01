import { describe, expect, it } from "vitest";
import {
  buildLeadSubmissionView,
  humanizeKey,
  resolveFieldLabel,
  toFieldValue,
  type LeadViewContext,
} from "./view";

const baseContext: LeadViewContext = {
  origin: { kind: "site", name: "Tasacion", domain: "tasacion.com.py" },
  contact: { name: "Ana", email: "ana@example.com", phone: "+595981123456" },
  fieldNames: { finalidad: "Finalidad", ciudad: "Ciudad" },
};

function submission(payload: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: "sub1",
    createdAt: new Date("2026-10-01T12:00:00Z"),
    payload,
    utm: {},
    notes: null,
    pageUrl: null,
    referrer: null,
    dealId: null,
    ...extra,
  };
}

describe("label resolution", () => {
  it("uses the dictionary for a known key, case-insensitively", () => {
    expect(resolveFieldLabel("Finalidad", { fieldNames: { finalidad: "Purpose" } })).toBe("Purpose");
    expect(resolveFieldLabel("ciudad", { fieldNames: { ciudad: "Stad" } })).toBe("Stad");
  });

  it("humanizes an unknown key", () => {
    expect(resolveFieldLabel("tipo_de_propiedad", {})).toBe("Tipo de propiedad");
    expect(humanizeKey("tipo-de-propiedad")).toBe("Tipo de propiedad");
    expect(humanizeKey("tipoDePropiedad")).toBe("Tipo de propiedad");
  });

  it("lets a hosted-form label win over the dictionary", () => {
    expect(
      resolveFieldLabel("ciudad", {
        formLabels: { ciudad: "¿En qué ciudad?" },
        fieldNames: { ciudad: "Ciudad" },
      }),
    ).toBe("¿En qué ciudad?");
  });

  it("lets a per-site override win over everything, trimmed and capped", () => {
    const siteSettings = { fieldLabels: { ciudad: `  Ciudad del inmueble${"x".repeat(100)}  ` } };
    const label = resolveFieldLabel("ciudad", {
      siteSettings,
      formLabels: { ciudad: "Form" },
      fieldNames: { ciudad: "Ciudad" },
    });
    expect(label.startsWith("Ciudad del inmueble")).toBe(true);
    expect(label.length).toBe(80);
    expect(
      resolveFieldLabel("Ciudad", { siteSettings: { fieldLabels: { ciudad: "Lower" } } }),
    ).toBe("Lower");
  });

  it("sorts prominent fields first and flags them", () => {
    const view = buildLeadSubmissionView(
      submission({ a: "1", finalidad: "venta", b: "2", ciudad: "Asunción" }),
      {
        ...baseContext,
        siteSettings: { fieldDisplay: { finalidad: { prominent: true }, ciudad: { prominent: true } } },
      },
    );
    expect(view.rows.map((row) => row.key)).toEqual(["finalidad", "ciudad", "a", "b"]);
    expect(view.rows.map((row) => row.prominent)).toEqual([true, true, false, false]);
  });

  it("applies label and prominence settings to the message too", () => {
    const view = buildLeadSubmissionView(submission({}, { notes: "Hola" }), {
      ...baseContext,
      siteSettings: { fieldLabels: { message: "Consulta" }, fieldDisplay: { message: { prominent: true } } },
    });
    expect(view.message).toBe("Hola");
    expect(view.messageLabel).toBe("Consulta");
    expect(view.messageProminent).toBe(true);
  });
});

describe("buildLeadSubmissionView rows", () => {
  it("makes a row for every payload key, including a randomly named one", () => {
    const random = `campo_${Math.random().toString(36).slice(2, 8)}`;
    const payload = { finalidad: "venta", ciudad: "Asunción", [random]: "valor" };
    const view = buildLeadSubmissionView(submission(payload), baseContext);
    expect(view.rows.map((row) => row.key).sort()).toEqual(Object.keys(payload).sort());
    expect(view.rows.find((row) => row.key === random)?.label).toBe(humanizeKey(random));
  });

  it("row count equals payload keys minus slot and deny keys", () => {
    const payload = {
      name: "Ana",
      phone: "0981",
      email: "a@b.com",
      message: "Hola",
      turnstile_token: "tok",
      "cf-turnstile-response": "tok",
      _hp: "",
      finalidad: "venta",
      extra: "x",
    };
    const view = buildLeadSubmissionView(submission(payload), baseContext);
    expect(view.rows.map((row) => row.key)).toEqual(["finalidad", "extra"]);
    expect(view.contact).toMatchObject({ name: "Ana", phone: "0981", email: "a@b.com", fromContact: false });
    expect(view.message).toBe("Hola");
  });

  it("falls back to the contact when the submission carries no identity", () => {
    const view = buildLeadSubmissionView(submission({}), baseContext);
    expect(view.contact).toEqual({
      name: "Ana",
      email: "ana@example.com",
      phone: "+595981123456",
      fromContact: true,
    });
  });

  it("keeps a slot-named key as a row when its value is not a usable string", () => {
    const view = buildLeadSubmissionView(submission({ email: { a: 1 }, name: "" }), baseContext);
    expect(view.rows.map((row) => row.key)).toEqual(["email", "name"]);
  });

  it("converts values by shape", () => {
    expect(toFieldValue({ a: [1, { b: 2 }] })).toEqual({
      kind: "json",
      text: JSON.stringify({ a: [1, { b: 2 }] }, null, 2),
    });
    expect(toFieldValue([{ a: 1 }]).kind).toBe("json");
    expect(toFieldValue(["a", 2, true])).toEqual({ kind: "list", items: ["a", "2", "true"] });
    expect(toFieldValue(false)).toEqual({ kind: "bool", value: false });
    expect(toFieldValue("")).toEqual({ kind: "empty" });
    expect(toFieldValue(null)).toEqual({ kind: "empty" });
    expect(toFieldValue(42)).toEqual({ kind: "text", text: "42" });
  });

  it("shows an empty value as a row, not a missing one", () => {
    const view = buildLeadSubmissionView(submission({ ciudad: "" }), baseContext);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].value).toEqual({ kind: "empty" });
  });

  it("reads attribution from utm, page_url and referrer", () => {
    const view = buildLeadSubmissionView(
      submission({}, { utm: { source: "google", gclid: "abc" }, pageUrl: "https://x.test/", referrer: "https://g.test/" }),
      baseContext,
    );
    expect(view.attribution).toMatchObject({
      utmSource: "google",
      gclid: "abc",
      utmMedium: null,
      pageUrl: "https://x.test/",
      referrer: "https://g.test/",
    });
  });
});

describe("ingest snapshot and repairs (§19.3)", () => {
  it("prefers what the submission was sent with over the contact's current values", () => {
    const view = buildLeadSubmissionView(
      submission(
        {},
        {
          submittedName: "Segunda",
          submittedEmail: "juan@gmail",
          submittedPhone: "+595981999999",
          source: "landing",
        },
      ),
      baseContext,
    );
    expect(view.contact).toEqual({
      name: "Segunda",
      email: "juan@gmail",
      phone: "+595981999999",
      fromContact: false,
    });
    expect(view.attribution.source).toBe("landing");
  });

  it("falls back to the contact for a row from before the snapshot", () => {
    const view = buildLeadSubmissionView(submission({}), baseContext);
    expect(view.contact).toMatchObject({ name: "Ana", email: "ana@example.com", fromContact: true });
    expect(view.attribution.source).toBeNull();
  });

  it("reads needs_review off the row and keeps _original out of the regular rows", () => {
    const view = buildLeadSubmissionView(
      submission(
        {
          finalidad: "Venta",
          _original: { message: "m".repeat(6000), ciudad: "c".repeat(20_000) },
          _original_cut: ["ciudad"],
        },
        { needsReview: ["message_truncated", "field_truncated:ciudad"] },
      ),
      baseContext,
    );
    expect(view.needsReview).toEqual(["message_truncated", "field_truncated:ciudad"]);
    expect(view.rows.map((row) => row.key)).toEqual(["finalidad"]);
    expect(view.originals).toEqual([
      { key: "message", label: "Message", text: "m".repeat(6000), cut: false },
      { key: "ciudad", label: "Ciudad", text: "c".repeat(20_000), cut: true },
    ]);
  });

  it("has nothing to review on a clean row", () => {
    const view = buildLeadSubmissionView(submission({ finalidad: "Venta" }, { needsReview: null }), baseContext);
    expect(view.needsReview).toEqual([]);
    expect(view.originals).toEqual([]);
  });
});
