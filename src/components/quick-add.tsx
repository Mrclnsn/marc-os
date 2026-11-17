import { captureAction, createTaskAction } from "@/app/actions";
import { AreaSelect, ClientSelect, ProjectSelect, type Option } from "./forms";

type Defaults = {
  area?: "zakelijk" | "prive";
  clientId?: string | null;
  projectId?: string | null;
  planDate?: string | null;
};

/** Snel een taak toevoegen. Extra velden zitten achter "Meer". */
export function QuickAddTask({ clients, projects, defaults = {}, placeholder = "Nieuwe taak..." }: { clients: Option[]; projects: Option[]; defaults?: Defaults; placeholder?: string }) {
  return (
    <form action={createTaskAction} className="card p-2">
      <div className="flex gap-2">
        <input name="title" required placeholder={placeholder} className="input flex-1 border-0 focus:border-0" autoComplete="off" />
        <button className="btn-primary">Toevoegen</button>
      </div>
      <details className="mt-1 px-1">
        <summary className="cursor-pointer select-none text-xs text-steen">Meer</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
          <AreaSelect value={defaults.area} />
          <ClientSelect clients={clients} value={defaults.clientId} />
          <ProjectSelect projects={projects} value={defaults.projectId} />
          <input type="date" name="planDate" defaultValue={defaults.planDate ?? ""} className="input" title="Wanneer doe je het" />
        </div>
      </details>
      {/* Zonder "Meer" open te klikken gelden deze standaardwaarden */}
    </form>
  );
}

/** Braindump: alles wat in je hoofd zit, zonder nadenken. */
export function CaptureBar() {
  return (
    <form action={captureAction} className="flex gap-2">
      <input name="text" placeholder="Braindump: typ iets en druk op enter" className="input flex-1" autoComplete="off" required />
      <button className="btn">Naar inbox</button>
    </form>
  );
}
