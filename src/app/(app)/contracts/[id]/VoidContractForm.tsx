"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form-fields";
import { voidContractAction } from "../actions";

export function VoidContractForm({
  contractId,
  labels,
}: {
  contractId: string;
  labels: { reason: string; warning: string; action: string };
}) {
  const [reason, setReason] = useState("");

  return (
    <form action={voidContractAction} className="flex max-w-md flex-col gap-2">
      <input type="hidden" name="contractId" value={contractId} />
      <p className="text-xs text-muted-foreground">{labels.warning}</p>
      <label className="flex flex-col gap-1 text-sm">
        {labels.reason}
        <Textarea
          name="reason"
          required
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <Button type="submit" variant="outline" disabled={!reason.trim()} className="w-fit">
        {labels.action}
      </Button>
    </form>
  );
}
