import { describe, expect, it } from "vitest";
import {
  FormFieldsInvalidError,
  assertKeysNotRenamed,
  slugifyFieldKey,
  validateFormFields,
  validateSubmissionData,
} from "./field-definitions";
import type { FormField } from "./field-definitions";

const phoneField: FormField = { key: "phone", label: "Teléfono", type: "phone", required: true };
const nameField: FormField = { key: "nombre", label: "Nombre", type: "text", required: false };

describe("validateFormFields", () => {
  it("accepts a valid field list", () => {
    const fields = validateFormFields([phoneField, nameField], []);
    expect(fields).toHaveLength(2);
  });

  it("requires exactly one required phone field", () => {
    expect(() => validateFormFields([nameField], [])).toThrow(FormFieldsInvalidError);
    expect(() =>
      validateFormFields([phoneField, { ...phoneField, key: "phone2" }], []),
    ).toThrow(/phone_required/);
  });

  it("rejects duplicate keys", () => {
    expect(() => validateFormFields([phoneField, { ...nameField, key: "phone" }], [])).toThrow(
      /duplicate_key/,
    );
  });

  it("requires at least one option on a select field", () => {
    const select: FormField = { key: "rubro", label: "Rubro", type: "select", required: false };
    expect(() => validateFormFields([phoneField, select], [])).toThrow(/select_needs_options/);
  });

  it("accepts a mapTo that names a real custom field, rejects one that doesn't", () => {
    const mapped: FormField = { ...nameField, mapTo: "rubro" };
    expect(validateFormFields([phoneField, mapped], ["rubro"])).toHaveLength(2);
    expect(() => validateFormFields([phoneField, mapped], ["otro"])).toThrow(/map_to_unknown/);
  });
});

describe("slugifyFieldKey", () => {
  it("slugifies the label when no raw key is given", () => {
    expect(slugifyFieldKey("", "¿Cuál es tu rubro?")).toBe("cual_es_tu_rubro");
  });

  it("prefers the raw key when given", () => {
    expect(slugifyFieldKey("Mi Clave", "Etiqueta")).toBe("mi_clave");
  });
});

describe("assertKeysNotRenamed", () => {
  it("allows a brand-new row (no original key)", () => {
    expect(() =>
      assertKeysNotRenamed([{ originalKey: null, key: "anything" }]),
    ).not.toThrow();
  });

  it("allows an existing row whose key is unchanged", () => {
    expect(() =>
      assertKeysNotRenamed([{ originalKey: "phone", key: "phone" }]),
    ).not.toThrow();
  });

  it("refuses an existing row whose key changed", () => {
    expect(() => assertKeysNotRenamed([{ originalKey: "phone", key: "telefono" }])).toThrow(
      /key_immutable/,
    );
  });
});

describe("validateSubmissionData", () => {
  const select: FormField = {
    key: "rubro",
    label: "Rubro",
    type: "select",
    required: false,
    options: ["Ferretería", "Panadería"],
  };

  it("passes when required fields are present and the select value is valid", () => {
    expect(() =>
      validateSubmissionData([phoneField, select], { phone: "0981123456", rubro: "Panadería" }),
    ).not.toThrow();
  });

  it("throws when a required field is missing", () => {
    expect(() => validateSubmissionData([phoneField], {})).toThrow(/field_required:phone/);
  });

  it("throws when a select value isn't one of its options", () => {
    expect(() =>
      validateSubmissionData([phoneField, select], { phone: "0981123456", rubro: "Otro" }),
    ).toThrow(/invalid_option:rubro/);
  });
});
