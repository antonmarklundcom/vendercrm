"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { sendTextAction, sendTemplateAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TemplateOption = { name: string; language: string };

export function SendBox({
  conversationId,
  windowOpen,
  templates,
}: {
  conversationId: string;
  windowOpen: boolean;
  templates: TemplateOption[];
}) {
  const t = useTranslations("app");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  if (!windowOpen) {
    return (
      <div className="border-t p-3">
        <p className="mb-2 text-xs text-destructive">{t("windowClosed")}</p>
        {templates.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noTemplates")}</p>
        ) : (
          <form
            action={async (fd: FormData) => {
              const [name, language] = String(fd.get("tpl")).split("|");
              await sendTemplateAction(conversationId, name, language);
            }}
            className="flex gap-2"
          >
            <select
              name="tpl"
              className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {templates.map((tpl) => (
                <option key={`${tpl.name}|${tpl.language}`} value={`${tpl.name}|${tpl.language}`}>
                  {tpl.name} ({tpl.language})
                </option>
              ))}
            </select>
            <Button type="submit" size="sm">
              {t("send")}
            </Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        setPending(true);
        await sendTextAction(conversationId, body);
        setBody("");
        setPending(false);
      }}
      className="flex gap-2 border-t p-3"
    >
      <Input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("typeMessage")}
        disabled={pending}
      />
      <Button type="submit" size="sm" disabled={pending}>
        {t("send")}
      </Button>
    </form>
  );
}
