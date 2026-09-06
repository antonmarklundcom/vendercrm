import { describe, expect, it } from "vitest";
import {
  extractVariableNames,
  findUnknownVariable,
  isKnownVariable,
  parseContractBody,
  renderContractBody,
} from "./render";

describe("parseContractBody", () => {
  it("splits headings and paragraphs on blank lines", () => {
    const blocks = parseContractBody(
      "# Contrato de servicio\n\nEste acuerdo es entre las partes.\n\n# Alcance\n\nSe presta el servicio X.",
    );
    expect(blocks).toEqual([
      { type: "heading", text: "Contrato de servicio" },
      { type: "paragraph", text: "Este acuerdo es entre las partes." },
      { type: "heading", text: "Alcance" },
      { type: "paragraph", text: "Se presta el servicio X." },
    ]);
  });

  it("drops empty blocks from extra blank lines", () => {
    const blocks = parseContractBody("Uno\n\n\n\nDos");
    expect(blocks).toEqual([
      { type: "paragraph", text: "Uno" },
      { type: "paragraph", text: "Dos" },
    ]);
  });

  it("treats a single newline as inside the same paragraph", () => {
    const blocks = parseContractBody("Línea uno\nLínea dos");
    expect(blocks).toEqual([{ type: "paragraph", text: "Línea uno\nLínea dos" }]);
  });
});

describe("extractVariableNames / isKnownVariable / findUnknownVariable", () => {
  it("extracts and lower-cases every variable, deduplicated", () => {
    expect(
      extractVariableNames("Hola {{Contacto.Nombre}}, tu tel es {{contacto.telefono}} ({{contacto.nombre}})"),
    ).toEqual(["contacto.nombre", "contacto.telefono"]);
  });

  it("knows the fixed contact fields", () => {
    expect(isKnownVariable("contacto.nombre", [])).toBe(true);
    expect(isKnownVariable("contacto.telefono", [])).toBe(true);
    expect(isKnownVariable("contacto.email", [])).toBe(true);
  });

  it("knows a custom field only when its key is in the tenant's set", () => {
    expect(isKnownVariable("contacto.custom.ruc", ["ruc"])).toBe(true);
    expect(isKnownVariable("contacto.custom.ruc", [])).toBe(false);
  });

  it("does not know negocio.* yet — that arrives with K3", () => {
    expect(isKnownVariable("negocio.nombre", [])).toBe(false);
  });

  it("findUnknownVariable reports the first name that does not resolve", () => {
    expect(findUnknownVariable("Hola {{contacto.nombre}}", [])).toBeNull();
    expect(findUnknownVariable("Hola {{negocio.nombre}}", [])).toBe("negocio.nombre");
    expect(findUnknownVariable("{{contacto.custom.ruc}}", [])).toBe("contacto.custom.ruc");
  });
});

describe("renderContractBody", () => {
  const values = {
    contacto: { nombre: "Ana Pérez", telefono: "+595981123456", email: "ana@example.com", custom: { ruc: "12345-6" } },
  };

  it("resolves the fixed contact fields", () => {
    expect(renderContractBody("Cliente: {{contacto.nombre}} ({{contacto.telefono}})", values)).toBe(
      "Cliente: Ana Pérez (+595981123456)",
    );
  });

  it("resolves a custom field by key", () => {
    expect(renderContractBody("RUC: {{contacto.custom.ruc}}", values)).toBe("RUC: 12345-6");
  });

  it("renders a missing custom key as empty", () => {
    expect(renderContractBody("{{contacto.custom.nope}}", values)).toBe("");
  });

  it("leaves an unresolved token as-is rather than throwing", () => {
    expect(renderContractBody("{{negocio.nombre}}", values)).toBe("{{negocio.nombre}}");
  });
});
