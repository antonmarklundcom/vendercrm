import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getContact } from "@/modules/crm/contacts";
import { listContactActivities } from "@/modules/crm/activities";
import { listDealsForContact } from "@/modules/crm/deals";
import { getDefaultPipeline, listStages } from "@/modules/crm/pipelines";
import { addNoteAction, createDealAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function activityLabel(
  type: string,
  payload: unknown,
): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (type) {
    case "note":
      return String(p.body ?? "");
    case "stage_change":
      return `Etapa → ${String(p.stageName ?? "")}`;
    case "form_submission":
      return `Formulario: ${String(p.formName ?? "")}`;
    case "quote_sent":
      return "Presupuesto enviado";
    case "call":
      return "Llamada";
    default:
      return type;
  }
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;
  const t = await getTranslations("app");
  const tc = await getTranslations("common");
  const ctx = await requireTenantContext();

  const contact = await getContact(ctx, contactId);
  if (!contact) notFound();

  const [activities, deals, pipeline] = await Promise.all([
    listContactActivities(ctx, contactId),
    listDealsForContact(ctx, contactId),
    getDefaultPipeline(ctx),
  ]);
  const stages = pipeline ? await listStages(ctx, pipeline.id) : [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{contact.name}</h1>
          <p className="text-sm text-muted-foreground">
            {contact.phone ?? "—"} · {contact.email ?? "—"} ·{" "}
            {contact.source ?? "—"}
          </p>
        </div>
        <Link href={`/app/quotes/new?contactId=${contactId}`}>
          <Button type="button" variant="outline" size="sm">
            {t("newQuote")}
          </Button>
        </Link>
      </header>

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="mb-3 font-semibold">{t("timeline")}</h2>
          <form
            action={async (fd: FormData) => {
              "use server";
              const body = String(fd.get("body") ?? "").trim();
              if (body) await addNoteAction(contactId, body);
            }}
            className="mb-4 flex gap-2"
          >
            <Input name="body" placeholder={t("addNote")} />
            <Button type="submit" size="sm">
              {tc("save")}
            </Button>
          </form>
          <ul className="flex flex-col gap-2">
            {activities.map((a) => (
              <li key={a.id} className="rounded-md border px-3 py-2 text-sm">
                <div>{activityLabel(a.type, a.payload)}</div>
                <div className="text-xs text-muted-foreground">
                  {a.createdAt.toLocaleString("es-PY")}
                </div>
              </li>
            ))}
            {activities.length === 0 && (
              <li className="text-sm text-muted-foreground">—</li>
            )}
          </ul>
        </section>

        <section>
          <h2 className="mb-3 font-semibold">{t("newDeal")}</h2>
          {pipeline ? (
            <form action={createDealAction} className="mb-4 flex flex-col gap-3">
              <input type="hidden" name="contactId" value={contactId} />
              <input type="hidden" name="pipelineId" value={pipeline.id} />
              <div className="grid gap-1.5">
                <Label htmlFor="title">{t("dealTitle")}</Label>
                <Input id="title" name="title" defaultValue={contact.name} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="stageId">{t("stage")}</Label>
                <select
                  id="stageId"
                  name="stageId"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="value">{t("value")} (PYG)</Label>
                <Input id="value" name="value" type="number" min={0} />
              </div>
              <Button type="submit" className="w-fit">
                {tc("create")}
              </Button>
            </form>
          ) : null}

          <ul className="flex flex-col gap-2">
            {deals.map((d) => (
              <li key={d.id} className="rounded-md border px-3 py-2 text-sm">
                {d.title}
                {d.value ? ` · ${d.value.toLocaleString("es-PY")} ${d.currency}` : ""}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
