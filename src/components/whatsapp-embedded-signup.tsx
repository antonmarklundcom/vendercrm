"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  isFacebookOrigin,
  parseEmbeddedSignupMessage,
} from "@/modules/whatsapp/embedded-signup-events";

// "Conectar con Facebook" — Meta Embedded Signup (PLAN.md §6.2). Shared by
// the tenant admin's /whatsapp page and the superadmin tenant view; each
// passes its own server action and message namespace. Rendered only when the
// owner configured Embedded Signup — the parent gets `config` from
// embeddedSignupClientConfig() and renders nothing without it.
//
// Meta hands back two things through two channels, in no guaranteed order:
// the exchangeable `code` in FB.login's callback, and the WABA / phone ids
// in a WA_EMBEDDED_SIGNUP `message` event. The server needs both, so each
// lands in a ref and the action runs once both are present.

export type EmbeddedSignupConfig = { appId: string; configId: string; graphVersion: string };
export type EmbeddedSignupMode = "cloud_api" | "coexistence";
export type EmbeddedSignupPayload = {
  code: string;
  wabaId: string;
  phoneNumberId?: string;
  mode: EmbeddedSignupMode;
};

type FbLoginResponse = { authResponse?: { code?: string } | null; status?: string };
type FacebookSdk = {
  init: (options: Record<string, unknown>) => void;
  login: (callback: (response: FbLoginResponse) => void, options: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_SCRIPT_ID = "facebook-jssdk";
const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
/** How long to wait for the ids after the code arrived (or vice versa). */
const PAIR_TIMEOUT_MS = 15_000;

function loadSdk(config: EmbeddedSignupConfig): Promise<FacebookSdk> {
  return new Promise((resolve, reject) => {
    const init = () => {
      if (!window.FB) return reject(new Error("FB missing"));
      window.FB.init({
        appId: config.appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: config.graphVersion,
      });
      resolve(window.FB);
    };
    if (window.FB) return init();
    window.fbAsyncInit = init;
    if (document.getElementById(SDK_SCRIPT_ID)) return;
    const script = document.createElement("script");
    script.id = SDK_SCRIPT_ID;
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => reject(new Error("sdk load failed"));
    document.body.appendChild(script);
  });
}

export function WhatsappEmbeddedSignup({
  config,
  namespace,
  complete,
}: {
  config: EmbeddedSignupConfig;
  namespace: "app.whatsapp" | "superadmin.tenantWhatsapp";
  complete: (payload: EmbeddedSignupPayload) => Promise<{ error: string | null }>;
}) {
  const t = useTranslations(namespace);
  const [sdk, setSdk] = useState<FacebookSdk | null>(null);
  const [sdkFailed, setSdkFailed] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(
    null,
  );
  const [waiting, setWaiting] = useState(false);
  const [pending, startTransition] = useTransition();

  const modeRef = useRef<EmbeddedSignupMode>("cloud_api");
  const codeRef = useRef<string | null>(null);
  const idsRef = useRef<{ wabaId: string; phoneNumberId?: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSdk(config).then(
      (loaded) => !cancelled && setSdk(loaded),
      () => !cancelled && setSdkFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [config]);

  const reset = useCallback(() => {
    codeRef.current = null;
    idsRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setWaiting(false);
  }, []);

  const tryComplete = useCallback(() => {
    const code = codeRef.current;
    const ids = idsRef.current;
    if (!code || !ids) {
      // One half arrived; give the other a bounded time before telling the
      // person something went wrong instead of spinning forever.
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          reset();
          setMessage({ tone: "error", text: t("errors.embedded.incomplete") });
        }, PAIR_TIMEOUT_MS);
      }
      return;
    }
    const payload: EmbeddedSignupPayload = { code, ...ids, mode: modeRef.current };
    reset();
    startTransition(async () => {
      const result = await complete(payload);
      setMessage(
        result.error
          ? { tone: "error", text: t(`errors.${result.error}` as "errors.unknown") }
          : { tone: "success", text: t("embedded.success") },
      );
    });
  }, [complete, reset, t]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isFacebookOrigin(event.origin)) return;
      const parsed = parseEmbeddedSignupMessage(event.data);
      switch (parsed.kind) {
        case "finish":
          idsRef.current = { wabaId: parsed.wabaId, phoneNumberId: parsed.phoneNumberId };
          tryComplete();
          break;
        case "cancel":
          reset();
          setMessage({ tone: "info", text: t("embedded.cancelled") });
          break;
        case "unsupported":
          reset();
          setMessage({ tone: "error", text: t("errors.embedded.unsupported") });
          break;
        case "error":
          reset();
          setMessage({
            tone: "error",
            text: parsed.message
              ? t("errors.embedded.metaError", { message: parsed.message })
              : t("errors.embedded.flowFailed"),
          });
          break;
        case "ignore":
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [reset, t, tryComplete]);

  useEffect(() => reset, [reset]);

  function launch(mode: EmbeddedSignupMode) {
    if (!sdk) return;
    reset();
    setMessage(null);
    modeRef.current = mode;
    setWaiting(true);
    // The callback must be synchronous — the SDK rejects an async function.
    sdk.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          // Closed without authorizing. The message listener may already
          // have said something more specific (cancel/error); don't
          // overwrite it.
          reset();
          setMessage((current) => current ?? { tone: "info", text: t("embedded.cancelled") });
          return;
        }
        codeRef.current = code;
        tryComplete();
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: "3",
          // Meta's documented feature type for onboarding a number that
          // stays on the WhatsApp Business app ("coexistence").
          ...(mode === "coexistence" ? { featureType: "whatsapp_business_app_onboarding" } : {}),
        },
      },
    );
  }

  const busy = !sdk || waiting || pending;

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("embedded.help")}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => launch("cloud_api")}>
          {pending ? t("embedded.working") : t("embedded.button")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => launch("coexistence")}
        >
          {t("embedded.coexistenceButton")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("embedded.coexistenceHelp")}</p>
      {sdkFailed && (
        <p role="alert" className="text-sm text-destructive">
          {t("errors.embedded.sdkFailed")}
        </p>
      )}
      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={
            message.tone === "error"
              ? "text-sm text-destructive"
              : message.tone === "success"
                ? "text-sm text-success"
                : "text-sm text-muted-foreground"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
