"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-fields";
import {
  connectUserToTenantAction,
  createTenantForUserAction,
  disconnectUserFromTenantAction,
} from "./actions";
import type { MembershipActionState } from "./actions";

// Lives here, not in actions.ts: a "use server" module may only export async
// functions, and the initial state is an object — exporting it there compiles
// and then throws on the first submit.
const EMPTY_MEMBERSHIP_STATE: MembershipActionState = { error: null, ok: false };

// One row's worth of membership editing: the businesses this person can
// reach, each with a disconnect, and one picker to add another. Client-side
// only so a failure ("that would leave the business with no admin") lands
// next to the row that caused it instead of on an error page.

export type UserMembershipRow = {
  tenantId: string;
  tenantName: string;
  role: string;
  banned: boolean;
};

export function UserMemberships({
  userId,
  memberships,
  tenants,
  roleLabels,
}: {
  userId: string;
  memberships: UserMembershipRow[];
  /** Every business, so the picker can offer the ones they are not in yet. */
  tenants: { id: string; name: string }[];
  roleLabels: { admin: string; agent: string };
}) {
  const t = useTranslations("superadmin.users");
  const [connectState, connect, connecting] = useActionState(
    connectUserToTenantAction,
    EMPTY_MEMBERSHIP_STATE,
  );
  const [disconnectState, disconnect, disconnecting] = useActionState(
    disconnectUserFromTenantAction,
    EMPTY_MEMBERSHIP_STATE,
  );
  const [createState, create, creating] = useActionState(
    createTenantForUserAction,
    EMPTY_MEMBERSHIP_STATE,
  );

  const joined = new Set(memberships.map((membership) => membership.tenantId));
  const available = tenants.filter((tenant) => !joined.has(tenant.id));
  const error = connectState.error ?? disconnectState.error ?? createState.error;

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2">
        {memberships.length === 0 && (
          <li className="text-sm text-muted-foreground">{t("noBusinesses")}</li>
        )}
        {memberships.map((membership) => (
          <li
            key={membership.tenantId}
            className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
          >
            <span>{membership.tenantName}</span>
            <span className="text-xs text-muted-foreground">
              {membership.role === "admin" ? roleLabels.admin : roleLabels.agent}
              {membership.banned && ` · ${t("deactivated")}`}
            </span>
            <form action={disconnect}>
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="tenantId" value={membership.tenantId} />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                disabled={disconnecting}
                className="h-6 px-2 text-destructive"
              >
                {t("disconnect")}
              </Button>
            </form>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <form action={connect} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={userId} />
          <Select name="tenantId" className="py-1 text-sm" defaultValue="">
            <option value="" disabled>
              {t("chooseBusiness")}
            </option>
            {available.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </Select>
          <Select name="role" className="py-1 text-sm" defaultValue="agent">
            <option value="admin">{roleLabels.admin}</option>
            <option value="agent">{roleLabels.agent}</option>
          </Select>
          <Button type="submit" size="sm" variant="outline" disabled={connecting}>
            {t("connect")}
          </Button>
        </form>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">{t("newBusiness")}</summary>
        <form action={create} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={userId} />
          <Input
            name="name"
            required
            maxLength={200}
            placeholder={t("newBusinessName")}
            aria-label={t("newBusinessName")}
            className="py-1 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={creating}>
            {t("createBusiness")}
          </Button>
        </form>
      </details>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}` as "errors.invalid")}
        </p>
      )}
    </div>
  );
}
