"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createQuoteAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Contact = { id: string; name: string };
type Product = { id: string; name: string; unitPrice: number };

type Line = { description: string; qty: number; unitPrice: number; productId?: string };

export function QuoteForm({
  contacts,
  products,
  defaultContactId,
}: {
  contacts: Contact[];
  products: Product[];
  defaultContactId?: string;
}) {
  const t = useTranslations("app");
  const tc = useTranslations("common");
  const [lines, setLines] = useState<Line[]>([
    { description: "", qty: 1, unitPrice: 0 },
  ]);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function pickProduct(i: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      updateLine(i, { productId: undefined });
      return;
    }
    updateLine(i, {
      productId,
      description: product.name,
      unitPrice: product.unitPrice,
    });
  }

  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);

  return (
    <form action={createQuoteAction} className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="contactId">{t("contact")}</Label>
        <select
          id="contactId"
          name="contactId"
          defaultValue={defaultContactId}
          required
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">—</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("description")}</Label>
        {lines.map((line, i) => (
          <div key={i} className="flex items-end gap-2">
            {products.length > 0 && (
              <select
                className="h-9 w-40 rounded-md border border-input bg-transparent px-2 text-xs"
                onChange={(e) => pickProduct(i, e.target.value)}
                defaultValue=""
              >
                <option value="">{t("products")}…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <input type="hidden" name="line_productId" value={line.productId ?? ""} />
            <Input
              name="line_description"
              placeholder={t("description")}
              value={line.description}
              onChange={(e) => updateLine(i, { description: e.target.value })}
              required
              className="flex-1"
            />
            <Input
              name="line_qty"
              type="number"
              min={1}
              value={line.qty}
              onChange={(e) => updateLine(i, { qty: Number(e.target.value) })}
              className="w-20"
            />
            <Input
              name="line_unitPrice"
              type="number"
              min={0}
              value={line.unitPrice}
              onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
              className="w-32"
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() =>
            setLines((prev) => [...prev, { description: "", qty: 1, unitPrice: 0 }])
          }
        >
          {t("addLine")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="discount">{t("discount")} (PYG)</Label>
          <Input id="discount" name="discount" type="number" min={0} defaultValue={0} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="validUntil">{t("validUntil")}</Label>
          <Input id="validUntil" name="validUntil" type="date" />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="notes">{t("notes")}</Label>
        <textarea
          id="notes"
          name="notes"
          className="min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <p className="text-sm text-muted-foreground">
        {t("subtotal")}: {subtotal.toLocaleString("es-PY")} PYG
      </p>

      <Button type="submit" className="w-fit">
        {tc("create")}
      </Button>
    </form>
  );
}
