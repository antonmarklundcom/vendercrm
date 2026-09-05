"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  currentSubscription,
  permissionState,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "./push-subscribe";

// "Activar notificaciones" in settings (PLAN.md §15.5 J2, §15.8 P2).
//
// About *this browser*, and says so: a person who turned pushes on at the shop
// counter and then opens settings on their laptop must not read "activo" and
// conclude the laptop will buzz. Everything the server knows — how many
// devices are registered, which kinds are muted — is rendered by the page
// around this; the one question only the browser can answer is whether this
// browser is one of them.

export type PushToggleLabels = {
  unsupported: string;
  blocked: string;
  active: string;
  inactive: string;
  enable: string;
  disable: string;
  failed: string;
};

type State = "loading" | "unsupported" | "blocked" | "on" | "off";

export function PushToggle({
  publicKey,
  labels,
}: {
  publicKey: string;
  labels: PushToggleLabels;
}) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await readState();
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setBusy(true);
    setFailed(false);
    const result = await subscribeToPush(publicKey);
    setState(result === "subscribed" ? "on" : await readState());
    setFailed(result === "failed");
    setBusy(false);
  }

  async function handleDisable() {
    setBusy(true);
    setFailed(false);
    const ok = await unsubscribeFromPush();
    setFailed(!ok);
    setState(await readState());
    setBusy(false);
  }

  // Nothing at all until the browser has answered — a control that flickers
  // from "activar" to "desactivar" on load reads as a bug.
  if (state === "loading") return null;

  if (state === "unsupported") {
    return <p className="text-sm text-muted-foreground">{labels.unsupported}</p>;
  }

  // Permission denied at the browser level cannot be undone from a page: only
  // the site settings can. Saying so beats a button that does nothing.
  if (state === "blocked") {
    return <p className="text-sm text-muted-foreground">{labels.blocked}</p>;
  }

  const on = state === "on";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`text-sm ${on ? "text-success" : "text-muted-foreground"}`}>
        {on ? labels.active : labels.inactive}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={on ? handleDisable : handleEnable}
      >
        {on ? labels.disable : labels.enable}
      </Button>
      {failed && <span className="text-sm text-destructive">{labels.failed}</span>}
    </div>
  );
}

async function readState(): Promise<State> {
  if (!pushSupported()) return "unsupported";
  if (permissionState() === "denied") return "blocked";
  return (await currentSubscription()) ? "on" : "off";
}
