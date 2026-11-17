"use client";

import { createContext, useContext } from "react";
import { DEFAULT_MODULES, type Modules } from "@/lib/modules";

const ModulesContext = createContext<Modules>(DEFAULT_MODULES);

/** Geeft de stand van de modules door aan onderdelen in de browser (bijv. de ▶-knop bij taken). */
export function ModulesProvider({ modules, children }: { modules: Modules; children: React.ReactNode }) {
  return <ModulesContext.Provider value={modules}>{children}</ModulesContext.Provider>;
}

export function useModules(): Modules {
  return useContext(ModulesContext);
}
