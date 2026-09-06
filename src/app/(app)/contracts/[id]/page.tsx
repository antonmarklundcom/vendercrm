import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/tenancy/context";
import { getContract, publicContractUrl } from "@/modules/contracts/contracts";
import { getContact } from "@/modules/crm/contacts";
import { Button } from "@/components/ui/button";
import {
  sendContractAction,
  sendContractByEmailAction,
} from "../actions";
import { VoidContractForm } from "./VoidContractForm";

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenantContext();
  const t = await getTranslations("app.contracts");
  const isAdmin = ctx.role === "admin";

  const contract = await getContract(ctx, id);
  if (!contract) notFound();

  const contact = await getContact(ctx, contract.contactId);
  const publicUrl = publicContractUrl(contract.publicToken);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{contract.number}</h1>
          <p className="text-sm text-muted-foreground">
            {contact?.name} · {contact?.phone}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(`statusValues.${contract.status}` as "statusValues.draft")}
          </p>
        </div>
        {contract.status === "draft" && (
          <div className="flex gap-2">
            <form action={sendContractAction}>
              <input type="hidden" name="contractId" value={contract.id} />
              <Button type="submit">{t("sendWhatsapp")}</Button>
            </form>
            {contact?.email && (
              <form action={sendContractByEmailAction}>
                <input type="hidden" name="contractId" value={contract.id} />
                <Button type="submit" variant="outline">
                  {t("sendEmail")}
                </Button>
              </form>
            )}
          </div>
        )}
        {contract.status === "sent" && contact?.email && (
          <form action={sendContractByEmailAction}>
            <input type="hidden" name="contractId" value={contract.id} />
            <Button type="submit" variant="outline">
              {t("sendEmail")}
            </Button>
          </form>
        )}
      </header>

      <section className="whitespace-pre-wrap rounded-md border p-4 text-sm">
        {contract.renderedBody}
      </section>

      {contract.status !== "draft" && (
        <section className="flex flex-col gap-2 text-sm">
          <p>
            {t("publicLink")}:{" "}
            <a href={publicUrl} className="underline">
              {publicUrl}
            </a>
          </p>
          <a href={`/c/${contract.publicToken}/pdf`} className="underline">
            {t("downloadPdf")}
          </a>
        </section>
      )}

      {contract.status === "accepted" && (
        <p className="rounded-md border bg-muted px-3 py-2 text-sm">{t("decisionAccepted")}</p>
      )}
      {contract.status === "declined" && (
        <p className="rounded-md border bg-muted px-3 py-2 text-sm">{t("decisionDeclined")}</p>
      )}
      {contract.status === "voided" && (
        <p className="rounded-md border border-warning/30 bg-warning-surface px-3 py-2 text-sm text-warning">
          {t("voidedNotice", { reason: contract.voidReason ?? "" })}
        </p>
      )}

      {isAdmin && contract.status !== "voided" && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("voidTitle")}</h2>
          <VoidContractForm
            contractId={contract.id}
            labels={{
              reason: t("voidReason"),
              warning: t("voidWarning"),
              action: t("voidAction"),
            }}
          />
        </section>
      )}

      <p className="text-sm text-muted-foreground">
        <Link href="/contracts" className="underline underline-offset-4">
          {t("title")}
        </Link>
      </p>
    </div>
  );
}
