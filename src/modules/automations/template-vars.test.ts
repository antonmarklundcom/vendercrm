import { describe, expect, it } from "vitest";
import { renderTemplateVars } from "./actions";

describe("renderTemplateVars", () => {
  const contact = {
    name: "Ana",
    phone: "+595981000000",
    custom: { ruc: "12345-6", zona: "{{contact.name}}" },
  };

  it("fills contact and custom-field variables", () => {
    expect(
      renderTemplateVars("Hola {{contact.name}}, RUC {{contacto.custom.ruc}}", contact),
    ).toBe("Hola Ana, RUC 12345-6");
  });

  it("renders an unknown custom key as empty", () => {
    expect(renderTemplateVars("[{{contacto.custom.nope}}]", contact)).toBe("[]");
  });

  it("prints a custom value as written rather than expanding it", () => {
    expect(renderTemplateVars("{{contacto.custom.zona}}", contact)).toBe("{{contact.name}}");
  });

  it("leaves text alone without a contact", () => {
    expect(renderTemplateVars("{{contacto.custom.ruc}}", null)).toBe("{{contacto.custom.ruc}}");
  });
});
