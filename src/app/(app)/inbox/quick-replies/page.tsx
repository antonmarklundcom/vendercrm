import { getTranslations } from "next-intl/server";
import { requireTenantAdmin } from "@/modules/tenancy/context";
import { listQuickReplies } from "@/modules/whatsapp/quick-replies";
import { PageHeader } from "@/components/page-header";
import { deleteQuickReplyAction, updateQuickReplyAction } from "../actions";
import { NewQuickReplyForm } from "./QuickReplyForms";
import { Input, Textarea } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";

// Quick reply management (PLAN.md §15.8 P3), admin-only. Kept under /inbox
// rather than in the tenant settings page: P3 does not own settings/page.tsx,
// and every other lane-2 phase this wave also touches it — an unrelated
// section here avoids a conflict at the one file everyone edits.
export default async function QuickRepliesPage() {
  const ctx = await requireTenantAdmin();
  const t = await getTranslations("app.inbox");
  const replies = await listQuickReplies(ctx);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("quickRepliesTitle")} description={t("quickRepliesIntro")} />

      <NewQuickReplyForm />

      <ul className="flex flex-col gap-3">
        {replies.map((reply) => (
          <li key={reply.id} className="flex flex-col gap-2 rounded-md border p-3">
            <form action={updateQuickReplyAction.bind(null, reply.id)} className="flex flex-col gap-2">
              <Input name="name" defaultValue={reply.name} required maxLength={100} />
              <Textarea name="body" defaultValue={reply.body} required maxLength={4096} />
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="outline">
                  {t("quickReplySave")}
                </Button>
              </div>
            </form>
            <form action={deleteQuickReplyAction.bind(null, reply.id)}>
              <button type="submit" className="text-xs text-destructive underline">
                {t("quickReplyDelete")}
              </button>
            </form>
          </li>
        ))}
        {replies.length === 0 && (
          <li className="text-sm text-muted-foreground">{t("quickRepliesEmpty")}</li>
        )}
      </ul>
    </div>
  );
}
