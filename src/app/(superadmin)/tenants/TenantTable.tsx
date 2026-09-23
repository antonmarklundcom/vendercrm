"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { Input, Select } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { impersonateAction } from "./[id]/actions";
import {
  bulkActivateTenantsAction,
  bulkDeleteTenantsAction,
  bulkGrantAccessAction,
  bulkSuspendTenantsAction,
  type BulkDeleteState,
  type BulkGrantAccessState,
  type BulkResultState,
} from "./actions";
import { pageCount, paginate, rowsToCsv, sortRows, type SortDirection, type SortKey } from "./table-helpers";

// The business list, filtered in the browser: the whole platform is a few
// dozen to a few hundred rows, which is one query and no round trip per
// keystroke. Search matches name, slug and every site domain, because the
// domain is what the operator actually remembers ("the gruas one").

export type TenantTableRow = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "trial";
  createdAt: string;
  sites: Array<{ domain: string | null; slug: string; isActive: boolean }>;
  members: number;
  contacts: number;
  lastLeadAt: string | null;
  firstActiveAdminUserId: string | null;
};

type StatusFilter = "all" | "active" | "trial" | "suspended";

const STATUS_TONE: Record<TenantTableRow["status"], string> = {
  active: "bg-success-surface text-success",
  trial: "bg-muted text-muted-foreground",
  suspended: "bg-destructive-surface text-destructive",
};

const PAGE_SIZE = 50;

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** `now` comes from the server render so relative times ("hace 3 días") read
 * the same on the server and in the browser. */
export function TenantTable({ rows, now }: { rows: TenantTableRow[]; now: string }) {
  const t = useTranslations("superadmin.tenants");
  const format = useFormatter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: rows.length, active: 0, trial: 0, suspended: 0 };
    for (const row of rows) c[row.status] += 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.slug.includes(q) ||
        row.sites.some((site) => (site.domain ?? site.slug).toLowerCase().includes(q))
      );
    });
  }, [rows, query, status]);

  const sorted = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  // A new search, filter or sort invalidates whatever page the operator was
  // on — starting over at page 1 is the only choice that can't land on an
  // empty or out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [query, status, sortKey, sortDir]);

  const totalPages = pageCount(sorted.length, PAGE_SIZE);
  const pageSafe = Math.min(page, totalPages);
  const paged = useMemo(() => paginate(sorted, pageSafe, PAGE_SIZE), [sorted, pageSafe]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleIds = paged.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleSelectVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function exportCsv() {
    downloadCsv(rowsToCsv(sorted), `empresas-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );

  function sortHeaderProps(key: SortKey) {
    return {
      onClick: () => toggleSort(key),
      "aria-sort": (sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none") as
        | "ascending"
        | "descending"
        | "none",
    };
  }

  function SortArrow({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    const Icon = sortDir === "asc" ? ArrowUp : ArrowDown;
    return <Icon className="inline size-3" aria-hidden="true" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">{t("search")}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-8"
          />
        </label>
        <div role="group" aria-label={t("status")} className="flex flex-wrap gap-1">
          {(["all", "active", "trial", "suspended"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              aria-pressed={status === value}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                status === value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {value === "all" ? t("filterAll") : t(`statusValues.${value}`)} · {counts[value]}
            </button>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={exportCsv}>
          <Download className="size-4" aria-hidden="true" />
          {t("exportCsv")}
        </Button>
      </div>

      {selected.size > 0 && (
        <BulkActionsBar
          selectedRows={selectedRows}
          onDone={() => setSelected(new Set())}
        />
      )}

      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("noMatches")}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="w-8 py-2 pr-2">
                    <input
                      type="checkbox"
                      aria-label={t("selectAllVisible")}
                      checked={allVisibleSelected}
                      onChange={toggleSelectVisible}
                    />
                  </th>
                  <th className="cursor-pointer py-2 pr-4 font-medium select-none" {...sortHeaderProps("name")}>
                    {t("name")} <SortArrow column="name" />
                  </th>
                  <th className="py-2 pr-4 font-medium">{t("sitesColumn")}</th>
                  <th
                    className="cursor-pointer py-2 pr-4 text-right font-medium select-none"
                    {...sortHeaderProps("members")}
                  >
                    {t("membersColumn")} <SortArrow column="members" />
                  </th>
                  <th
                    className="cursor-pointer py-2 pr-4 text-right font-medium select-none"
                    {...sortHeaderProps("contacts")}
                  >
                    {t("contactsColumn")} <SortArrow column="contacts" />
                  </th>
                  <th
                    className="cursor-pointer py-2 pr-4 font-medium select-none"
                    {...sortHeaderProps("lastLead")}
                  >
                    {t("lastLeadColumn")} <SortArrow column="lastLead" />
                  </th>
                  <th
                    className="cursor-pointer py-2 pr-4 font-medium select-none"
                    {...sortHeaderProps("createdAt")}
                  >
                    {t("createdColumn")} <SortArrow column="createdAt" />
                  </th>
                  <th className="py-2 pr-4 font-medium">{t("status")}</th>
                  <th className="py-2 font-medium">{t("enter")}</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <tr key={row.id} className="border-b align-top hover:bg-accent/40">
                    <td className="py-2.5 pr-2">
                      <input
                        type="checkbox"
                        aria-label={row.name}
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                      />
                    </td>
                    <td className="py-2.5 pr-4">
                      <Link href={`/tenants/${row.id}`} className="font-medium hover:underline">
                        {row.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{row.slug}</p>
                    </td>
                    <td className="py-2.5 pr-4">
                      {row.sites.length === 0 ? (
                        <span className="text-xs text-muted-foreground">{t("noSite")}</span>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {row.sites.map((site) => (
                            <li key={site.slug} className="flex items-center gap-1.5 text-xs">
                              <span
                                className={cn(
                                  "size-1.5 shrink-0 rounded-full",
                                  site.isActive ? "bg-success" : "bg-muted-foreground/40",
                                )}
                                aria-hidden="true"
                              />
                              <span>{site.domain ?? site.slug}</span>
                              {!site.isActive && (
                                <span className="text-muted-foreground">({t("siteInactive")})</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{row.members}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{row.contacts}</td>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                      {row.lastLeadAt
                        ? format.relativeTime(new Date(row.lastLeadAt), new Date(now))
                        : t("never")}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                      {format.relativeTime(new Date(row.createdAt), new Date(now))}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2 py-0.5 text-xs",
                          STATUS_TONE[row.status],
                        )}
                      >
                        {t(`statusValues.${row.status}`)}
                      </span>
                    </td>
                    <td className="py-2.5">
                      {row.firstActiveAdminUserId ? (
                        <form action={impersonateAction}>
                          <input type="hidden" name="userId" value={row.firstActiveAdminUserId} />
                          <input type="hidden" name="tenantId" value={row.id} />
                          <Button type="submit" size="sm" variant="outline">
                            {t("enter")}
                          </Button>
                        </form>
                      ) : (
                        <Button type="button" size="sm" variant="outline" disabled title={t("enterDisabled")}>
                          {t("enter")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {t("pageRange", {
                from: sorted.length === 0 ? 0 : (pageSafe - 1) * PAGE_SIZE + 1,
                to: Math.min(pageSafe * PAGE_SIZE, sorted.length),
                total: sorted.length,
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pageSafe <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                {t("prevPage")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pageSafe >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t("nextPage")}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// --- Bulk actions bar --------------------------------------------------

const initialBulkResult: BulkResultState = { message: null, error: null };
const initialGrantState: BulkGrantAccessState = { message: null, error: null, values: {} };
const initialDeleteState: BulkDeleteState = { message: null, error: null };

function BulkActionsBar({
  selectedRows,
  onDone,
}: {
  selectedRows: TenantTableRow[];
  onDone: () => void;
}) {
  const t = useTranslations("superadmin.tenants");
  const [grantOpen, setGrantOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [suspendState, suspendAction, suspendPending] = useActionState(
    bulkSuspendTenantsAction,
    initialBulkResult,
  );
  const [activateState, activateAction, activatePending] = useActionState(
    bulkActivateTenantsAction,
    initialBulkResult,
  );

  useEffect(() => {
    if (suspendState.message) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspendState.message]);
  useEffect(() => {
    if (activateState.message) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateState.message]);

  const lastMessage = suspendState.message ?? activateState.message;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-accent/30 px-3 py-2 text-sm">
      <span className="font-medium">{t("selectedCount", { count: selectedRows.length })}</span>

      <form action={suspendAction}>
        {selectedRows.map((row) => (
          <input key={row.id} type="hidden" name="tenantId" value={row.id} />
        ))}
        <Button type="submit" size="sm" variant="outline" disabled={suspendPending}>
          {t("suspend")}
        </Button>
      </form>

      <form action={activateAction}>
        {selectedRows.map((row) => (
          <input key={row.id} type="hidden" name="tenantId" value={row.id} />
        ))}
        <Button type="submit" size="sm" variant="outline" disabled={activatePending}>
          {t("activate")}
        </Button>
      </form>

      <Button type="button" size="sm" variant="outline" onClick={() => setGrantOpen(true)}>
        {t("bulkGrantAccess")}
      </Button>

      <Button type="button" size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
        {t("danger.submit")}
      </Button>

      {lastMessage && (
        <span role="status" className="text-xs text-muted-foreground">
          {describeBulkMessage(lastMessage, t)}
        </span>
      )}

      <BulkGrantAccessDialog
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        selectedRows={selectedRows}
        onDone={onDone}
      />
      <BulkDeleteDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        selectedRows={selectedRows}
        onDone={onDone}
      />
    </div>
  );
}

function describeBulkMessage(message: string, t: ReturnType<typeof useTranslations<"superadmin.tenants">>) {
  const [kind, ...rest] = message.split(":");
  if (kind === "bulkSuspended") return t("bulkSuspended", { count: Number(rest[0]) });
  if (kind === "bulkActivated") return t("bulkActivated", { count: Number(rest[0]) });
  if (kind === "bulkGranted") {
    return t("bulkGranted", { added: Number(rest[0]), skipped: Number(rest[1]) });
  }
  if (kind === "bulkDeleted") return t("bulkDeleted", { count: Number(rest[0]) });
  return message;
}

function BulkGrantAccessDialog({
  open,
  onClose,
  selectedRows,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  selectedRows: TenantTableRow[];
  onDone: () => void;
}) {
  const t = useTranslations("superadmin.tenants");
  const tu = useTranslations("superadmin.tenantUsers");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(bulkGrantAccessAction, initialGrantState);

  useEffect(() => {
    if (state.message) {
      onDone();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message]);

  return (
    <Dialog open={open} onClose={onClose} label={t("bulkGrantAccess")} className="max-w-md">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <h2 className="text-base font-semibold">{t("bulkGrantAccess")}</h2>
      </div>
      <div className="px-5 py-4">
        <p className="mb-3 text-sm text-muted-foreground">
          {t("bulkGrantAccessIntro", { count: selectedRows.length })}
        </p>
        <form action={formAction} className="flex flex-col gap-3">
          {selectedRows.map((row) => (
            <input key={row.id} type="hidden" name="tenantId" value={row.id} />
          ))}
          <label className="flex flex-col gap-1 text-sm">
            {tu("email")}
            <Input name="email" type="email" defaultValue={state.values.email ?? ""} required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {tu("role")}
            <Select name="role" defaultValue={state.values.role ?? "agent"}>
              <option value="admin">{tu("roles.admin")}</option>
              <option value="agent">{tu("roles.agent")}</option>
            </Select>
          </label>
          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error === "invalid"
                ? tu("errors.invalid")
                : tu(`addExisting.errors.${state.error}` as "addExisting.errors.userNotFound")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {tu("addExisting.submit")}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

function BulkDeleteDialog({
  open,
  onClose,
  selectedRows,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  selectedRows: TenantTableRow[];
  onDone: () => void;
}) {
  const t = useTranslations("superadmin.tenants");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(bulkDeleteTenantsAction, initialDeleteState);
  const [typed, setTyped] = useState("");
  const expected = `ELIMINAR ${selectedRows.length}`;

  useEffect(() => {
    if (state.message) {
      onDone();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message]);

  return (
    <Dialog open={open} onClose={onClose} label={t("danger.submit")} className="max-w-md">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <h2 className="text-base font-semibold text-destructive">{t("danger.title")}</h2>
      </div>
      <div className="px-5 py-4">
        <p className="mb-3 text-sm text-muted-foreground">
          {t("bulkDeleteBody", { count: selectedRows.length })}
        </p>
        <form action={formAction} className="flex flex-col gap-3">
          {selectedRows.map((row) => (
            <input key={row.id} type="hidden" name="tenantId" value={row.id} />
          ))}
          <label className="flex flex-col gap-1 text-sm">
            {t("bulkDeleteConfirmLabel", { expected })}
            <Input
              name="confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </label>
          {state.error && (
            <p role="alert" className="text-xs text-destructive">
              {t(`danger.errors.${state.error}` as "danger.errors.unknown")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending || typed.trim() !== expected}>
              {t("danger.submit")}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
