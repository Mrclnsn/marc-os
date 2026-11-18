"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addCalendarFeedAction, deleteCalendarFeedAction, setCalendarFeedActiveAction, testCalendarFeedAction, updateCalendarFeedAction, type FeedResult } from "@/app/leven-actions";
import { Switch } from "./settings-parts";

export type FeedRow = { id: string; name: string; masked: string; active: boolean; lastOkAt: string | null; lastError: string | null; source: "app" | "env" };

function Message({ state }: { state: FeedResult | null }) {
  if (!state) return null;
  return <p className={`text-sm ${state.ok ? "text-steen" : "font-bold text-nacht"}`} role="status">{state.ok ? state.message : state.error}</p>;
}

const fmt = (iso: string) => new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" }).format(new Date(iso));

/** Agenda-links toevoegen in de app (ICS, alleen lezen). */
export function AddFeedForm() {
  const [state, formAction, pending] = useActionState(addCalendarFeedAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="space-y-3 p-4">
      <p className="font-bold text-nacht">Agenda toevoegen</p>
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <label className="block">
          <span className="label">Naam</span>
          <input name="name" placeholder="Bijv. Werk, Privé, Gezin" className="input w-full" />
        </label>
        <label className="block">
          <span className="label">Agenda-link (iCal / ICS)</span>
          <input name="url" placeholder="https://calendar.google.com/calendar/ical/.../basic.ics of webcal://..." className="input w-full" required autoComplete="off" spellCheck={false} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Bezig met ophalen…" : "Toevoegen en testen"}</button>
        <Message state={state} />
      </div>
      <details className="text-sm text-grafiet">
        <summary className="cursor-pointer text-steen hover:text-nacht">Waar vind ik de link?</summary>
        <div className="mt-2 space-y-2">
          <p>
            <b>Google Agenda</b> (op de computer): Instellingen → kies links de agenda → &quot;Agenda integreren&quot; → kopieer <b>Geheim adres in iCal-indeling</b>.
          </p>
          <p>
            <b>iCloud</b>: in de Agenda-app op de Mac rechtsklik op de agenda → Deel agenda → vink <b>Openbare agenda</b> aan → kopieer de link (begint met webcal://). Of op icloud.com/calendar via het deelicoon naast de agenda.
          </p>
          <p>
            <b>Outlook / Microsoft 365</b>: Instellingen → Agenda → Gedeelde agenda&apos;s → Een agenda publiceren → kopieer de <b>ICS</b>-link.
          </p>
          <p className="text-steen">De link is geheim: wie hem heeft, kan je agenda lezen. Marc OS toont hem daarom na opslaan niet meer volledig. Alleen lezen: Marc OS schrijft niets in je agenda.</p>
        </div>
      </details>
    </form>
  );
}

export function FeedItem({ feed }: { feed: FeedRow }) {
  if (feed.source === "env") {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="font-bold text-nacht">{feed.name}</p>
          <p className="truncate text-xs text-steen">{feed.masked} · uit .env (CALENDAR_ICS_URLS); wijzigen of verwijderen in .env op de server</p>
        </div>
      </li>
    );
  }
  return <AppFeedItem feed={feed} />;
}

function AppFeedItem({ feed }: { feed: FeedRow }) {
  const [state, setState] = useState<FeedResult | null>(null);
  const [editState, editAction, editing] = useActionState(updateCalendarFeedAction.bind(null, feed.id), null);
  const [pending, start] = useTransition();
  const [active, setActive] = useState(feed.active);
  const shown = state ?? editState;

  return (
    <li className={`space-y-2 px-4 py-3 ${pending ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-bold ${active ? "text-nacht" : "text-steen"}`}>{feed.name}</p>
          <p className="truncate text-xs text-steen">
            {feed.masked}
            {feed.lastError ? ` · fout: ${feed.lastError}` : feed.lastOkAt ? ` · laatst geladen ${fmt(feed.lastOkAt)}` : " · nog niet geladen"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={() => start(async () => setState(await testCalendarFeedAction(feed.id)))}>
            Testen
          </button>
          <Switch
            on={active}
            label={`${feed.name} tonen`}
            onChange={(next) =>
              start(async () => {
                setActive(next);
                await setCalendarFeedActiveAction(feed.id, next);
              })
            }
          />
        </div>
      </div>
      <Message state={shown} />
      <details>
        <summary className="cursor-pointer text-xs text-steen hover:text-nacht">Naam of link wijzigen, verwijderen</summary>
        <form action={editAction} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="label">Naam</span>
            <input name="name" defaultValue={feed.name} className="input w-[180px]" />
          </label>
          <label className="block min-w-[220px] flex-1">
            <span className="label">Nieuwe link (leeg = houden)</span>
            <input name="url" placeholder="https://..." className="input w-full" autoComplete="off" spellCheck={false} />
          </label>
          <button className="btn" disabled={editing}>Opslaan</button>
          <button
            type="button"
            className="btn-ghost text-xs text-nacht"
            onClick={() => confirm(`Agenda "${feed.name}" verwijderen uit Marc OS? Je agenda zelf blijft bestaan.`) && start(() => deleteCalendarFeedAction(feed.id))}
          >
            Verwijderen
          </button>
        </form>
      </details>
    </li>
  );
}
