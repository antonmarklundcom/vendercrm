import { MessagesSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { useLocale } from "next-intl";
import { formatDateTime } from "@/lib/i18n/format";
import { Select, Textarea } from "@/components/ui/form-fields";
import { AssigneePicker, type AssignableUser } from "@/app/(app)/inbox/AssigneePicker";

// The WhatsApp thread rendered inside the contact record. Same 24h-window
// rules the inbox enforces (§6.5): inside the window, free-form text; once it
// closes, only approved templates. Showing why the box is disabled is the
// point — a rep who doesn't know about Meta's window just sees a broken form.

export type ThreadMessage = {
  id: string;
  direction: "in" | "out";
  body: string | null;
  status: string | null;
  hasMedia: boolean;
  at: Date;
};

export type ThreadLabels = {
  empty: string;
  emptyBody: string;
  noMessages: string;
  placeholder: string;
  send: string;
  windowOpen: string;
  windowClosed: string;
  sendTemplate: string;
  noTemplates: string;
  media: string;
};

export function ConversationThread({
  conversationId,
  assignedUserId,
  assignableUsers,
  messages,
  windowOpen,
  remaining,
  templates,
  labels,
  sendMessage,
  sendTemplate,
}: {
  conversationId: string | null;
  assignedUserId: string | null;
  assignableUsers: AssignableUser[];
  messages: ThreadMessage[];
  windowOpen: boolean;
  remaining: string;
  templates: { name: string; language: string }[];
  labels: ThreadLabels;
  sendMessage: (formData: FormData) => Promise<void>;
  sendTemplate: (formData: FormData) => Promise<void>;
}) {
  // Before the early return: hooks are not conditional.
  const locale = useLocale();

  if (!conversationId) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title={labels.empty}
        description={labels.emptyBody}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The same picker the inbox thread uses, imported rather than
          reimplemented: a rep working from the contact record is making the
          identical decision and must not meet a different control for it. */}
      <AssigneePicker
        conversationId={conversationId}
        assignedUserId={assignedUserId}
        users={assignableUsers}
      />

      <p className="text-sm text-muted-foreground">
        {windowOpen ? `${labels.windowOpen} ${remaining}` : labels.windowClosed}
      </p>

      <ul className="flex flex-col gap-2">
        {messages.map((message) => (
          <li
            key={message.id}
            className={cn(
              "max-w-[80%] rounded-lg px-3 py-2 text-sm",
              message.direction === "out"
                ? "self-end bg-primary text-primary-foreground"
                : "self-start border bg-muted",
            )}
          >
            {message.body ?? (message.hasMedia ? labels.media : "")}
            <span
              className={cn(
                "mt-1 block text-[10px]",
                message.direction === "out"
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground",
              )}
            >
              {formatDateTime(message.at, locale)}
              {message.direction === "out" && message.status ? ` · ${message.status}` : ""}
            </span>
          </li>
        ))}
        {messages.length === 0 && (
          <li className="text-sm text-muted-foreground">{labels.noMessages}</li>
        )}
      </ul>

      {windowOpen ? (
        <form action={sendMessage} className="flex flex-col gap-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <Textarea
            name="body"
            required
            rows={3}
            placeholder={labels.placeholder}
          />
          <Button type="submit" size="sm" className="w-fit">
            {labels.send}
          </Button>
        </form>
      ) : templates.length > 0 ? (
        <form action={sendTemplate} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="conversationId" value={conversationId} />
          <Select name="template">
            {templates.map((template) => (
              <option
                key={`${template.name}|${template.language}`}
                value={`${template.name}|${template.language}`}
              >
                {template.name} ({template.language})
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="outline">
            {labels.sendTemplate}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{labels.noTemplates}</p>
      )}
    </div>
  );
}
