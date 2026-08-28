import Link from "next/link";
import { ArrowDown, ArrowUp, Download, Upload, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { listTags } from "@/modules/crm/contacts";
import {
  contactsWithOpenDeals,
  listContactSources,
  queryContacts,
  type ContactSortField,
} from "@/modules/crm/contact-list";
import { listTenantUsers } from "@/modules/tenancy/users";
import { listPipelines, listStagesForPipeline } from "@/modules/crm/pipelines";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ContactsTable, type StageOption } from "./ContactsTable";
import { ContactCreateForm } from "./ContactCreateForm";
import { SavedViews } from "./SavedViews";
import { createTagAction } from "./actions";
import { FormDialogTrigger } from "@/components/ui/form-dialog";
import { listContactViews } from "@/modules/crm/contact-views";
import {
  buildContactHref,
  hasActiveFilters,
  parseContactOptions,
  parseContactQuery,
  serializeContactView,
  type ContactSearchParams,
} from "./query";
import { formatDate } from "@/lib/i18n/format";
import { getLocale } from "next-intl/server";
import { Input, Select } from "@/components/ui/form-fields";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<ContactSearchParams>;
}) {
  const params = await searchParams;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.contacts");
  const locale = await getLocale();
  const tc = await getTranslations("common");

  const query = parseContactQuery(params);
  const options = parseContactOptions(params);

  const [page, tags, sources, users, openDeals, pipelines, views] = await Promise.all([
    queryContacts(ctx, query, options),
    listTags(ctx),
    listContactSources(ctx),
    listTenantUsers(ctx),
    contactsWithOpenDeals(ctx),
    listPipelines(ctx),
    listContactViews(ctx),
  ]);

  // Stages, kept grouped by pipeline: the filter's <optgroup>s need the
  // grouping, and the bulk "add to pipeline" picker needs the same list
  // flattened. A tenant can run more than one pipeline, so both have to span
  // them rather than assume one — same reasoning as /sites's routing picker.
  const pipelineStages = await Promise.all(
    pipelines.map(async (pipeline) => ({
      pipeline,
      stages: await listStagesForPipeline(ctx, pipeline.id),
    })),
  );

  const stageOptions: StageOption[] = pipelineStages.flatMap(({ pipeline, stages }) =>
    stages.map((stage) => ({
      id: stage.id,
      pipelineId: pipeline.id,
      label: `${pipeline.name} › ${stage.name}`,
    })),
  );

  const filtered = hasActiveFilters(params);
  const isFirstTime = page.total === 0 && !filtered;
  const userNames = new Map(users.map((user) => [user.id, user.name]));

  const activeSort = options.sort ?? "createdAt";
  const activeDir = options.direction ?? (activeSort === "createdAt" ? "desc" : "asc");

  /** Column header that toggles direction when it's already the active sort. */
  function SortHeader({
    field,
    label,
    className,
  }: {
    field: ContactSortField;
    label: string;
    className?: string;
  }) {
    const isActive = activeSort === field;
    const nextDir = isActive && activeDir === "asc" ? "desc" : "asc";
    return (
      <th className={cn("py-2 font-medium", className)}>
        <Link
          href={buildContactHref(params, { sort: field, dir: nextDir, page: "1" })}
          className="inline-flex items-center gap-1 hover:underline"
        >
          {label}
          {isActive &&
            (activeDir === "asc" ? (
              <ArrowUp className="size-3.5" aria-hidden="true" />
            ) : (
              <ArrowDown className="size-3.5" aria-hidden="true" />
            ))}
        </Link>
      </th>
    );
  }

  const exportHref = `/api/exports/contacts${buildContactHref(params, { page: undefined })}`;

  // What "guardar vista" would store, and what marks the matching chip as the
  // one you are looking at.
  const activeQuery = serializeContactView(params);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <PageHeader
          title={t("title")}
          description={t("intro")}
          action={
            <div className="flex flex-wrap gap-2">
              <FormDialogTrigger id="nuevo-contacto" label={t("createTitle")} title={t("createTitle")}>
                <ContactCreateForm />
              </FormDialogTrigger>
              {/* Import is offered even on an empty list — a brand-new
                  tenant migrating off GoHighLevel starts here (§13 H6). */}
              <Link
                href="/contacts/import"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <Upload className="size-4" aria-hidden="true" />
                {t("importAction")}
              </Link>
              {page.total > 0 && (
                <a
                  href={exportHref}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  <Download className="size-4" aria-hidden="true" />
                  {t("exportCsv")}
                </a>
              )}
            </div>
          }
        />

        {!isFirstTime && (
          <SavedViews
            activeQuery={activeQuery}
            views={views.map((view) => ({
              id: view.id,
              name: view.name,
              query: view.query,
              canDelete: ctx.role === "admin" || view.createdByUserId === ctx.userId,
            }))}
          />
        )}

        {!isFirstTime && (
          <form className="flex flex-wrap items-end gap-2" method="get">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("searchLabel")}
              <Input
                name="search"
                defaultValue={params.search ?? ""}
                placeholder={t("searchPlaceholder")}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("tag")}
              <Select
                name="tagId"
                defaultValue={params.tagId ?? ""}
              >
                <option value="">{t("allTags")}</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("source")}
              <Select
                name="source"
                defaultValue={params.source ?? ""}
              >
                <option value="">{t("allSources")}</option>
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("owner")}
              <Select
                name="ownerUserId"
                defaultValue={params.ownerUserId ?? ""}
              >
                <option value="">{t("allOwners")}</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </label>
            {pipelines.length > 0 && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("pipeline")}
                <Select name="pipelineId" defaultValue={params.pipelineId ?? ""}>
                  <option value="">{t("allPipelines")}</option>
                  {pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {stageOptions.length > 0 && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("stage")}
                {/* Grouped by pipeline and independent of the pipeline select:
                    picking a stage is the narrower answer, and queryContacts
                    lets it win rather than making the two agree. */}
                <Select name="stageId" defaultValue={params.stageId ?? ""}>
                  <option value="">{t("allStages")}</option>
                  {pipelineStages.map(({ pipeline, stages }) => (
                    <optgroup key={pipeline.id} label={pipeline.name}>
                      {stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("createdFrom")}
              <Input
                name="from"
                type="date"
                defaultValue={params.from ?? ""}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("createdTo")}
              <Input
                name="to"
                type="date"
                defaultValue={params.to ?? ""}
              />
            </label>
            <label className="flex items-center gap-2 py-2 text-sm">
              <input
                type="checkbox"
                name="openDeal"
                value="1"
                defaultChecked={params.openDeal === "1"}
              />
              {t("onlyOpenDeal")}
            </label>
            {/* Sorting lives in the URL too, so it must survive a filter submit. */}
            {params.sort && <input type="hidden" name="sort" value={params.sort} />}
            {params.dir && <input type="hidden" name="dir" value={params.dir} />}
            <Button type="submit" variant="outline" size="sm">
              {t("filter")}
            </Button>
            {filtered && (
              <Link
                href="/contacts"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                {t("clearFilters")}
              </Link>
            )}
          </form>
        )}

        {isFirstTime ? (
          <EmptyState
            icon={Users}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            actionLabel={t("emptyAction")}
            actionHref="#nuevo-contacto"
          />
        ) : page.total === 0 ? (
          <EmptyState
            icon={Users}
            title={t("noResults")}
            description={t("noResultsBody")}
            actionLabel={t("clearFilters")}
            actionHref="/contacts"
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t("resultCount", { count: page.total })}
            </p>

            <ContactsTable
              rows={page.rows.map((contact) => ({
                id: contact.id,
                name: contact.name,
                phone: contact.phone,
                email: contact.email,
                source: contact.source,
                ownerName: contact.ownerUserId ? (userNames.get(contact.ownerUserId) ?? null) : null,
                createdAtLabel: formatDate(contact.createdAt, locale),
                hasOpenDeal: openDeals.has(contact.id),
              }))}
              nameHeader={<SortHeader field="name" label={t("name")} />}
              phoneHeader={<SortHeader field="phone" label={t("phone")} />}
              createdHeader={<SortHeader field="createdAt" label={t("created")} />}
              tags={tags}
              users={users}
              stages={stageOptions}
              exportBaseHref={exportHref}
              canDelete={ctx.role === "admin"}
              labels={{
                name: t("name"),
                phone: t("phone"),
                email: t("email"),
                source: t("source"),
                owner: t("owner"),
                created: t("created"),
                openDealBadge: t("openDealBadge"),
                // Raw (not t()): the client component does its own
                // "{count}" substitution as selection changes, so this must
                // stay an unformatted template — t() would eagerly demand a
                // count argument and throw FORMATTING_ERROR on every render.
                selectedCount: t.raw("bulk.selectedCount"),
                addTag: t("bulk.addTag"),
                chooseTag: t("bulk.chooseTag"),
                assignOwner: t("bulk.assignOwner"),
                chooseOwner: t("bulk.chooseOwner"),
                noOwner: t("bulk.noOwner"),
                addToPipeline: t("bulk.addToPipeline"),
                chooseStage: t("bulk.chooseStage"),
                apply: t("bulk.apply"),
                exportSelection: t("bulk.exportSelection"),
                clearSelection: t("bulk.clearSelection"),
                // Raw for the same reason as selectedCount above: the client
                // substitutes the count itself as the selection changes.
                deleteSelection: t("bulk.deleteSelection"),
                deleteConfirm: t.raw("bulk.deleteConfirm"),
                deleteDone: t.raw("bulk.deleteDone"),
                deleteBlocked: t.raw("bulk.deleteBlocked"),
              }}
            />

            {page.pageCount > 1 && (
              <nav className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t("pageOf", { page: page.page, pages: page.pageCount })}
                </span>
                <span className="flex gap-2">
                  <Link
                    href={buildContactHref(params, { page: String(page.page - 1) })}
                    aria-disabled={page.page <= 1}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      page.page <= 1 && "pointer-events-none opacity-50",
                    )}
                  >
                    {t("previous")}
                  </Link>
                  <Link
                    href={buildContactHref(params, { page: String(page.page + 1) })}
                    aria-disabled={page.page >= page.pageCount}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      page.page >= page.pageCount && "pointer-events-none opacity-50",
                    )}
                  >
                    {t("next")}
                  </Link>
                </span>
              </nav>
            )}
          </>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">{t("createTagTitle")}</h2>
        <form action={createTagAction} className="flex max-w-sm gap-2">
          <Input
            name="name"
            required
            className="flex-1"
          />
          <Button type="submit" variant="outline">
            {tc("create")}
          </Button>
        </form>
      </section>
    </div>
  );
}
