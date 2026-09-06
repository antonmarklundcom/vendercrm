import { describe, expect, it } from "vitest";
import { renderReceiptPdf } from "./receipt-pdf";
import { money } from "@/modules/renderable-document/format";

// Same fingerprint approach as renderable-document/pdf.test.tsx (§13 H9):
// react-pdf's creation timestamp and file id are normalised out, so what's
// left is a stable fingerprint of the layout — including that the one total
// line renders in PYG's thousands-separated, no-decimals format.
const FIXTURE_BRANDING = { primaryColor: "#0f766e" };

const receipt = {
  number: "REC-000007",
  documentNumber: "NV-000045",
  tenantName: "Acme SRL",
  branding: FIXTURE_BRANDING,
  contactName: "Ana Gómez",
  contactPhone: "+595981123456",
  currency: "PYG",
  amount: 1350000,
  method: "cash" as const,
  reference: "Recibo mostrador",
  paidAt: new Date("2026-03-10T12:00:00.000Z"),
  createdAt: new Date("2026-03-10T12:00:00.000Z"),
  locale: "es",
};

async function fingerprint(pdf: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  const normalised = pdf
    .toString("latin1")
    .replace(/D:\d{14}Z/g, "D:00000000000000Z")
    .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, "/ID [<0> <0>]");
  return createHash("sha256").update(normalised).digest("hex");
}

describe("receipt PDF", () => {
  it("renders the one-line total in PYG formatting, pixel-stable", async () => {
    // PYG has no minor unit: the same money() the shell calls for the total
    // line must render a plain thousands-grouped integer, never "...,00".
    expect(money(receipt.amount, receipt.currency, receipt.locale)).toBe("PYG 1.350.000");

    const pdf = await renderReceiptPdf(receipt);
    expect(await fingerprint(pdf)).toBe(
      "5c429561454f6d28906fc67357288e4cefeace0f52f1a3987019e584a181d61a",
    );
  });
});
