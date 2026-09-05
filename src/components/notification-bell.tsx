"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

// The in-app half of `notify_user` (PLAN.md §15.5 J1). Web push (P2) is a
// second delivery of the same rows, never a replacement: a user who declined
// the browser permission, or who is on an iPhone, still finds everything
// here.
//
// Server-rendered list, no polling: the count is as fresh as the page. A
// live count is P2's job, when there is a service worker to update it.

export type NotificationItem = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  read: boolean;
  when: string;
};

export function NotificationBell({
  items,
  unread,
  labels,
  onMarkAllRead,
}: {
  items: NotificationItem[];
  unread: number;
  labels: { title: string; empty: string; markAllRead: string };
  /** Server action; the form posts to it and the page re-renders. */
  onMarkAllRead: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={labels.title}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
      >
        <Bell className="size-4" aria-hidden />
        <span className="flex-1 text-left">{labels.title}</span>
        {unread > 0 && (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-2 right-2 z-20 mt-1 max-h-80 overflow-y-auto rounded-md border bg-card p-2 shadow-lg">
          {items.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">{labels.empty}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <li key={item.id}>
                  <NotificationRow item={item} onNavigate={() => setOpen(false)} />
                </li>
              ))}
            </ul>
          )}

          {unread > 0 && (
            <form action={onMarkAllRead} className="pt-2">
              <Button type="submit" size="sm" variant="outline" className="w-full">
                {labels.markAllRead}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  item,
  onNavigate,
}: {
  item: NotificationItem;
  onNavigate: () => void;
}) {
  const content = (
    <>
      <span className={item.read ? "text-muted-foreground" : "font-medium"}>{item.title}</span>
      {item.body && <span className="block text-xs text-muted-foreground">{item.body}</span>}
      <span className="block text-xs text-muted-foreground/70">{item.when}</span>
    </>
  );

  return item.url ? (
    <Link
      href={item.url}
      onClick={onNavigate}
      className="block rounded-md px-2 py-1.5 text-sm hover:bg-muted"
    >
      {content}
    </Link>
  ) : (
    <div className="rounded-md px-2 py-1.5 text-sm">{content}</div>
  );
}
