"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Select } from "@/components/ui/form-fields";
import { assignConversationAction } from "./actions";

export type AssignableUser = { id: string; name: string };

/**
 * Who owns this conversation. One component for both places it appears —
 * the inbox thread and the contact record's conversation tab — because the
 * decision is the same one in both, and a second copy would be the third
 * place assignment could drift.
 *
 * Submits on change rather than behind a save button: there is exactly one
 * field, and a picker that needs confirming is a picker reps forget to
 * confirm. That also removes the usual polling hazard — the 5s refresh
 * (§10 1R #3) cannot clobber unsaved state, because there is never any.
 *
 * What the refresh *can* do is show the rep an assignment someone else made,
 * which is the whole point of showing an owner. `selectKey` below is how:
 * the `<select>` is uncontrolled and remounts only when the stored value
 * actually changes, so a poll tick that changes nothing leaves an open
 * dropdown alone, and a colleague taking the conversation is reflected
 * immediately.
 */
export function AssigneePicker({
  conversationId,
  assignedUserId,
  users,
}: {
  conversationId: string;
  assignedUserId: string | null;
  users: AssignableUser[];
}) {
  const t = useTranslations("app.inbox");
  const [pending, startTransition] = useTransition();

  function handleChange(userId: string) {
    const formData = new FormData();
    formData.set("conversationId", conversationId);
    formData.set("userId", userId);

    startTransition(async () => {
      try {
        await assignConversationAction(formData);
      } catch {
        // assignConversation throws when the chosen user is no longer an
        // active member of this tenant — deactivated between the page render
        // and the click. Saying so beats a select that silently snaps back.
        toast.error(t("assignFailed"));
      }
    });
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("assignedTo")}</span>
      <Select
        key={assignedUserId ?? ""}
        name="userId"
        defaultValue={assignedUserId ?? ""}
        disabled={pending}
        onChange={(event) => handleChange(event.target.value)}
      >
        <option value="">{t("assignUnassigned")}</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
