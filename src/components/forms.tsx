import { AREAS, CLIENT_STATUS, NOTE_TYPES, PROJECT_STATUS, RECURRENCE, TASK_STATUS } from "@/lib/labels";

export type Option = { id: string; name: string; clientId?: string | null };

export function AreaSelect({ value, name = "area", allowEmpty = false }: { value?: string | null; name?: string; allowEmpty?: boolean }) {
  return (
    <select name={name} defaultValue={value ?? (allowEmpty ? "" : "zakelijk")} className="input">
      {allowEmpty && <option value="">Geen gebied</option>}
      {Object.entries(AREAS).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

export function ClientSelect({ clients, value, name = "clientId" }: { clients: Option[]; value?: string | null; name?: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} className="input">
      <option value="">Geen klant</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

export function ProjectSelect({ projects, value, name = "projectId" }: { projects: Option[]; value?: string | null; name?: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} className="input">
      <option value="">Geen project</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function EnumSelect({ map, name, value }: { map: Record<string, string>; name: string; value?: string | null }) {
  return (
    <select name={name} defaultValue={value ?? Object.keys(map)[0]} className="input">
      {Object.entries(map).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

export const TaskStatusSelect = (p: { value?: string | null }) => <EnumSelect map={TASK_STATUS} name="status" {...p} />;
export const RecurrenceSelect = (p: { value?: string | null }) => <EnumSelect map={RECURRENCE} name="recurrence" {...p} />;
export const ProjectStatusSelect = (p: { value?: string | null }) => <EnumSelect map={PROJECT_STATUS} name="status" {...p} />;
export const ClientStatusSelect = (p: { value?: string | null }) => <EnumSelect map={CLIENT_STATUS} name="status" {...p} />;
export const NoteTypeSelect = (p: { value?: string | null; withoutInbox?: boolean }) => {
  const map = p.withoutInbox ? Object.fromEntries(Object.entries(NOTE_TYPES).filter(([k]) => k !== "inbox")) : NOTE_TYPES;
  return <EnumSelect map={map} name="type" value={p.value} />;
};

export function PrioritySelect({ value }: { value?: number | null }) {
  return (
    <select name="priority" defaultValue={String(value ?? 2)} className="input">
      <option value="1">Hoog</option>
      <option value="2">Normaal</option>
      <option value="3">Laag</option>
    </select>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
