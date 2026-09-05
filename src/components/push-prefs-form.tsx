import { Button } from "@/components/ui/button";
import { PUSH_KINDS, type PushKind } from "@/modules/notifications/prefs";

// Which pushes this person wants (PLAN.md §15.5 J2, §15.8 P2).
//
// A plain server-rendered form, like TaskReminderToggle: checkboxes and a
// save button, no client state to get out of step with the row. The muting is
// per person and applies to every browser they have — it is a preference
// about *being interrupted*, which does not change depending on which device
// happens to be in their hand.

export function PushPrefsForm({
  enabled,
  labels,
  action,
}: {
  /** Per kind, whether the push is currently on for this user. */
  enabled: Record<PushKind, boolean>;
  labels: { kinds: Record<PushKind, string>; save: string; note: string };
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action} className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {PUSH_KINDS.map((kind) => (
          <li key={kind}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={kind}
                defaultChecked={enabled[kind]}
                className="size-4 rounded border-input"
              />
              {labels.kinds[kind]}
            </label>
          </li>
        ))}
      </ul>
      <p className="max-w-2xl text-sm text-muted-foreground">{labels.note}</p>
      <div>
        <Button type="submit" size="sm" variant="outline">
          {labels.save}
        </Button>
      </div>
    </form>
  );
}
