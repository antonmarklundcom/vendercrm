"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export type InboxConversation = {
  id: string;
  channel: "whatsapp" | "webchat";
  href: string;
  contactId: string | null;
  contactName: string;
  contactPhone: string;
  unreadCount: number;
  assignedUserId: string | null;
};

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// Inbox list, 5s polling (PLAN.md §6.5): SWR revalidates in the background
// and swaps in the new list without a full navigation, so the rep isn't
// staring at a page reload while working the queue.
export function InboxList({
  initial,
  userNames,
}: {
  initial: InboxConversation[];
  /** Every user the tenant has ever had, deactivated ones included — a
   *  conversation assigned before someone left must still show their name
   *  rather than read as unassigned. The picker itself offers only active
   *  users; this map is for display. */
  userNames: Record<string, string>;
}) {
  const t = useTranslations("app.inbox");
  const router = useRouter();
  // Search/filter change the query the server component reads, so the poll
  // has to hit the same URL rather than the bare conversations endpoint —
  // otherwise a rep who filtered to "mine" would see "all" creep back in 5s
  // later.
  const query = typeof window !== "undefined" ? window.location.search : "";
  const { data } = useSWR<{ conversations: InboxConversation[] }>(
    `/api/inbox/conversations${query}`,
    fetcher,
    { fallbackData: { conversations: initial }, refreshInterval: 5000 },
  );

  const conversations = data?.conversations ?? initial;

  // Keyboard: j/k move a highlighted row, Enter opens it (§15.8 P3). Ignored
  // while typing anywhere (e.g. the search box) so a literal "j" or "k" is
  // never stolen from a form field.
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;

      if (event.key === "j") {
        event.preventDefault();
        setSelected((i) => Math.min(i + 1, conversations.length - 1));
      } else if (event.key === "k") {
        event.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter") {
        const row = conversations[selected];
        if (row) router.push(row.href);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [conversations, selected, router]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <ul ref={listRef} className="flex flex-col gap-2 text-sm">
      {conversations.map((conversation, index) => (
        <li key={`${conversation.channel}-${conversation.id}`} data-index={index}>
          <Link
            href={conversation.href}
            className={`flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent ${
              index === selected ? "border-primary" : ""
            }`}
          >
            <span>
              <span className="mr-2 rounded-full border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                {t(conversation.channel === "whatsapp" ? "channelWhatsapp" : "channelWebchat")}
              </span>
              <span className="font-medium">{conversation.contactName}</span>{" "}
              <span className="text-muted-foreground">{conversation.contactPhone}</span>
              {/* Owner on the row, not just inside the thread: triaging the
                  queue means seeing at a glance which conversations nobody
                  has taken (§6.5). */}
              <span className="block text-xs text-muted-foreground">
                {conversation.assignedUserId
                  ? t("assignedToName", {
                      name:
                        userNames[conversation.assignedUserId] ?? conversation.assignedUserId,
                    })
                  : t("assignUnassigned")}
              </span>
            </span>
            {conversation.unreadCount > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                {conversation.unreadCount}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
