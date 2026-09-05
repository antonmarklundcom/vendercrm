"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

// `beforeinstallprompt` only fires on Chromium (Android Chrome/Edge, desktop
// Chrome) when the page passes the install criteria (manifest + HTTPS) and
// isn't already installed — iOS Safari and Firefox never fire it, which is
// exactly the Android-only gating this button needs, with no UA sniffing.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppButton({ label }: { label: string }) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  if (!installEvent) return null;

  async function handleInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    // Spent either way — a fresh prompt only arrives on a later page load.
    setInstallEvent(null);
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleInstall}>
      <Download className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
