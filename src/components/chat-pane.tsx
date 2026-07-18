"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { sendMessage } from "@/modules/whatsapp/send";

type Message = {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  templateName: string | null;
  status: string;
  createdAt: string;
};

type Template = { id: string; name: string; language: string };

export function ChatPane({
  conversationId,
  initialMessages,
  templates,
  initialWithinWindow,
}: {
  conversationId: string;
  initialMessages: Message[];
  templates: Template[];
  initialWithinWindow: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/inbox/${conversationId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function handleSendText(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);

    startTransition(async () => {
      try {
        await sendMessage(conversationId, { type: "text", body });
        setBody("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al enviar");
      }
    });
  }

  function handleSendTemplate(e: React.FormEvent) {
    e.preventDefault();
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setError(null);

    startTransition(async () => {
      try {
        await sendMessage(conversationId, {
          type: "template",
          templateName: template.name,
          language: template.language,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al enviar");
      }
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg border border-border p-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-md rounded-lg px-3 py-2 text-sm ${
              m.direction === "out"
                ? "self-end bg-primary text-primary-foreground"
                : "self-start bg-muted"
            }`}
          >
            {m.type === "template" ? (
              <p className="italic">Plantilla: {m.templateName}</p>
            ) : (
              <p>{m.body}</p>
            )}
            <p className="mt-1 text-xs opacity-70">
              {m.createdAt.slice(0, 16).replace("T", " ")} · {m.status}
            </p>
          </div>
        ))}
        <div ref={bottomRef} />
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">Sin mensajes todavía.</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {initialWithinWindow ? (
        <form onSubmit={handleSendText} className="flex gap-2">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escribí un mensaje..."
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <Button type="submit" disabled={pending}>
            Enviar
          </Button>
        </form>
      ) : (
        <form onSubmit={handleSendTemplate} className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            La ventana de 24 horas está cerrada — enviá una plantilla aprobada.
          </p>
          <div className="flex gap-2">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
            <Button type="submit" disabled={pending || templates.length === 0}>
              Enviar plantilla
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
