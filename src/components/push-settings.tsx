"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { setPushPrefAction, subscribePushAction, testPushAction, unsubscribePushAction } from "@/app/push-actions";
import type { PushKind } from "@/lib/push";
import { Switch } from "./settings-parts";

function keyToBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToKey(buf: ArrayBuffer | null) {
  if (!buf) return "";
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type State = "loading" | "unsupported" | "install" | "denied" | "off" | "on";

/** Registreert de service worker op elke pagina, zodat meldingen ook binnenkomen als Instellingen niet open staat. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}

/** Pushmeldingen op dit apparaat aan- of uitzetten, plus een testmelding. */
export function PushThisDevice({ publicKey, knownEndpoints }: { publicKey: string; knownEndpoints: string[] }) {
  const [state, setState] = useState<State>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      let sub = await reg.pushManager.getSubscription();
      // Andere sleutel op de server (bijv. na herinstallatie): opnieuw aanmelden
      if (sub && bytesToKey(sub.options.applicationServerKey) !== publicKey) {
        await sub.unsubscribe();
        sub = null;
      }
      if (sub) {
        setEndpoint(sub.endpoint);
        setState("on");
        if (!knownEndpoints.includes(sub.endpoint)) await subscribePushAction(sub.toJSON() as never);
      } else setState("off");
    })().catch((e) => {
      setState("unsupported");
      setMessage(e instanceof Error ? e.message : String(e));
    });
    // Alleen bij laden; knownEndpoints verandert na aanmelden en mag dit niet opnieuw starten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  const enable = () =>
    start(async () => {
      setMessage(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
        await subscribePushAction(sub.toJSON() as never);
        setEndpoint(sub.endpoint);
        setState("on");
      } catch (e) {
        setMessage(`Aanzetten lukte niet: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      await sub?.unsubscribe();
      if (endpoint) await unsubscribePushAction({ endpoint });
      setEndpoint(null);
      setState("off");
    });

  const test = () =>
    start(async () => {
      const r = await testPushAction();
      setMessage(r.skipped ?? `Verstuurd naar ${r.sent} van ${r.devices} apparaten${r.failed ? `, ${r.failed} mislukt` : ""}${r.removed ? `, ${r.removed} verlopen apparaat opgeruimd` : ""}.`);
    });

  const text: Record<State, string> = {
    loading: "Even kijken…",
    unsupported: "Deze browser ondersteunt geen pushmeldingen.",
    install: "Op de iPhone werken meldingen alleen in de app op je beginscherm: open Marc OS in Safari, tik op Deel → Zet op beginscherm, open de app vanaf het beginscherm en kom hier terug.",
    denied: "Meldingen zijn geblokkeerd voor Marc OS. Zet ze aan in de instellingen van je telefoon of browser (bij de iPhone: Instellingen → Meldingen → Marc OS) en laad deze pagina opnieuw.",
    off: "Dit apparaat ontvangt nog geen meldingen.",
    on: "Dit apparaat ontvangt meldingen.",
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="min-w-0 max-w-2xl">
        <p className="font-bold text-nacht">Dit apparaat</p>
        <p className="text-sm text-grafiet">{text[state]}</p>
        {message && <p className="mt-1 text-xs text-steen">{message}</p>}
      </div>
      <div className={`flex flex-wrap gap-2 ${pending ? "opacity-60" : ""}`}>
        {state === "off" && (
          <button type="button" className="btn" onClick={enable} disabled={pending}>
            Meldingen aanzetten
          </button>
        )}
        {state === "on" && (
          <>
            <button type="button" className="btn" onClick={test} disabled={pending}>
              Testmelding
            </button>
            <button type="button" className="btn-ghost" onClick={disable} disabled={pending}>
              Uitzetten
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function PushPrefSwitch({ kind, on, label }: { kind: PushKind; on: boolean; label: string }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useOptimistic(on);
  return (
    <span className={pending ? "opacity-60" : ""}>
      <Switch
        on={value}
        label={label}
        onChange={(next) =>
          start(async () => {
            setValue(next);
            await setPushPrefAction(kind, next);
          })
        }
      />
    </span>
  );
}

export function RemoveDeviceButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="text-xs text-steen hover:text-nacht hover:underline" disabled={pending} onClick={() => start(() => unsubscribePushAction({ id }))}>
      {pending ? "Bezig…" : "Verwijderen"}
    </button>
  );
}
