"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Download, Trash2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  bulkAddTagAction,
  bulkAddToPipelineAction,
  bulkAssignOwnerAction,
  bulkDeleteContactsAction,
} from "./bulk-actions";
import { Select } from "@/components/ui/form-fields";

// Row selection + bulk actions (PLAN.md §10 1J #1). Calls the server actions
// directly as plain async functions rather than through a <form> — Next.js
// lets a client component invoke a "use server" function like any other
// async call, which avoids reconstructing FormData for three different
// action shapes (tag, owner, pipeline+stage all take different arguments).

export type ContactRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  source: string | null;
  ownerName: string | null;
  createdAtLabel: string;
  hasOpenDeal: boolean;
  /**
   * Built server-side, where the tenant's dialing country is known
   * (plan-booking.md §6.2). Null when the stored number is not dialable.
   */
  whatsappHref: string | null;
};

export type StageOption = { id: string; pipelineId: string; label: string };

export type ContactsTableLabels = {
  name: string;
  phone: string;
  email: string;
  source: string;
  owner: string;
  created: string;
  openDealBadge: string;
  selectedCount: string;
  addTag: string;
  chooseTag: string;
  assignOwner: string;
  chooseOwner: string;
  noOwner: string;
  addToPipeline: string;
  chooseStage: string;
  apply: string;
  exportSelection: string;
  clearSelection: string;
  deleteSelection: string;
  deleteConfirm: string;
  deleteDone: string;
  deleteBlocked: string;
};

export function ContactsTable({
  rows,
  nameHeader,
  phoneHeader,
  createdHeader,
  tags,
  users,
  stages,
  exportBaseHref,
  canDelete,
  labels,
}: {
  rows: ContactRow[];
  nameHeader: React.ReactNode;
  phoneHeader: React.ReactNode;
  createdHeader: React.ReactNode;
  tags: { id: string; name: string }[];
  users: { id: string; name: string }[];
  stages: StageOption[];
  /** The current filter/sort querystring, so "export selection" carries the
   * same view — just narrowed to the checked rows — rather than resetting it. */
  exportBaseHref: string;
  /** Bulk delete is admin-only (§3.2), so the button is only rendered for
   * one — the server action re-checks the role regardless. */
  canDelete: boolean;
  labels: ContactsTableLabels;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [tagId, setTagId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [stageId, setStageId] = useState("");
  const [deleteReport, setDeleteReport] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedIds = useMemo(() => [...selected], [selected]);

  const exportSelectionHref = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const separator = exportBaseHref.includes("?") ? "&" : "?";
    return `${exportBaseHref}${separator}ids=${selectedIds.join(",")}`;
  }, [exportBaseHref, selectedIds]);

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">
            {labels.selectedCount.replace("{count}", String(selected.size))}
          </span>

          <Select
            value={tagId}
            onChange={(event) => setTagId(event.target.value)}
            className="bg-background px-2 py-1"
          >
            <option value="">{labels.chooseTag}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!tagId || pending}
            onClick={() =>
              startTransition(async () => {
                await bulkAddTagAction(selectedIds, tagId);
                setTagId("");
              })
            }
          >
            {labels.addTag}
          </Button>

          <Select
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            className="bg-background px-2 py-1"
          >
            <option value="">{labels.chooseOwner}</option>
            <option value="__none__">{labels.noOwner}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!ownerId || pending}
            onClick={() =>
              startTransition(async () => {
                await bulkAssignOwnerAction(selectedIds, ownerId === "__none__" ? "" : ownerId);
                setOwnerId("");
              })
            }
          >
            {labels.assignOwner}
          </Button>

          {stages.length > 0 && (
            <>
              <Select
                value={stageId}
                onChange={(event) => setStageId(event.target.value)}
                className="bg-background px-2 py-1"
              >
                <option value="">{labels.chooseStage}</option>
                {stages.map((stage) => (
                  <option key={stage.id} value={`${stage.pipelineId}|${stage.id}`}>
                    {stage.label}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!stageId || pending}
                onClick={() =>
                  startTransition(async () => {
                    const [pipelineId, id] = stageId.split("|");
                    await bulkAddToPipelineAction(selectedIds, pipelineId, id);
                    setStageId("");
                  })
                }
              >
                {labels.addToPipeline}
              </Button>
            </>
          )}

          {canDelete && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => {
                // A native confirm rather than a dialog component: this is the
                // one bulk action that destroys rows, and the count is the
                // whole question being asked.
                if (!window.confirm(labels.deleteConfirm.replace("{count}", String(selected.size))))
                  return;
                startTransition(async () => {
                  const result = await bulkDeleteContactsAction(selectedIds);
                  const parts = [labels.deleteDone.replace("{count}", String(result.deleted))];
                  // Only mentioned when it happened — "0 conservados" reads
                  // like a warning about nothing.
                  if (result.blocked > 0) {
                    parts.push(labels.deleteBlocked.replace("{count}", String(result.blocked)));
                  }
                  setDeleteReport(parts.join(" · "));
                  setSelected(new Set());
                });
              }}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {labels.deleteSelection}
            </Button>
          )}

          {exportSelectionHref && (
            <a
              href={exportSelectionHref}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Download className="size-3.5" aria-hidden="true" />
              {labels.exportSelection}
            </a>
          )}

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-muted-foreground underline underline-offset-4"
          >
            {labels.clearSelection}
          </button>
        </div>
      )}

      {deleteReport && (
        <p role="status" className="text-sm text-muted-foreground">
          {deleteReport}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="w-8 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={labels.selectedCount}
                />
              </th>
              {nameHeader}
              {phoneHeader}
              <th className="py-2 font-medium">{labels.email}</th>
              <th className="py-2 font-medium">{labels.source}</th>
              <th className="py-2 font-medium">{labels.owner}</th>
              {createdHeader}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    aria-label={row.name}
                  />
                </td>
                <td className="py-2">
                  <Link href={`/contacts/${row.id}`} className="underline underline-offset-4">
                    {row.name}
                  </Link>
                  {row.hasOpenDeal && (
                    <span className="ml-2 rounded-full bg-success-surface px-2 py-0.5 text-[10px] whitespace-nowrap text-success">
                      {labels.openDealBadge}
                    </span>
                  )}
                </td>
                <td className="py-2 tabular-nums">
                  {row.whatsappHref ? (
                    <a
                      href={row.whatsappHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="WhatsApp"
                      className="underline underline-offset-2 hover:text-foreground"
                      // The row itself navigates to the contact; opening
                      // WhatsApp must not also open the detail page behind it.
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.phone}
                    </a>
                  ) : (
                    row.phone
                  )}
                </td>
                <td className="py-2">{row.email}</td>
                <td className="py-2">{row.source}</td>
                <td className="py-2">{row.ownerName}</td>
                <td className="py-2 tabular-nums">{row.createdAtLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
