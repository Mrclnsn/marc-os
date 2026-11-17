import Link from "next/link";
import { PageHeader } from "./brand";
import { MODULES, type ModuleKey } from "@/lib/modules";

/** Melding op een direct adres naar een pagina van een uitgeschakelde module. */
export function ModuleOff({ module }: { module: ModuleKey }) {
  const m = MODULES[module];
  return (
    <div>
      <PageHeader eyebrow="Module uitgeschakeld" title={m.label} />
      <div className="card max-w-xl border-l-[3px] border-l-nacht p-5">
        <p className="text-[15px] text-grafiet">Deze module staat tijdelijk uit, zodat Marc OS rustig en overzichtelijk blijft. Je gegevens zijn bewaard.</p>
        <p className="mt-2 text-sm text-steen">{m.description}</p>
        <Link href="/instellingen#modules" className="btn-primary mt-5">Naar Instellingen → Modules</Link>
      </div>
    </div>
  );
}
