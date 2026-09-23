// The one page-header pattern for the signed-in app
// (prompts/fable-crm-design-calm-down.md, goal 3): title and a one-line
// explanation on the left, the page's actions on the right, and an optional
// toolbar row (filters, saved views, pipeline tabs) underneath.
//
// The description is what turns a bare CRUD screen into something a new
// tenant can read their way into; it's optional so pages that genuinely
// need no explanation don't invent one. Actions are ordered by the caller
// with the primary one last, so it lands at the right edge where the eye
// ends on a wide screen and at the end of the row when they wrap.

export function PageHeader({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Toolbar row under the title: filters, view switchers. */
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {/* basis-80 keeps the title column from collapsing under a long
            action row: the actions wrap below it instead. */}
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
          {description && (
            <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
    </header>
  );
}
