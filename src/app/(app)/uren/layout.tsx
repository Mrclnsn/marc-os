import { ModuleOff } from "@/components/module-off";
import { isModuleOn } from "@/lib/settings";

/** Module uren: bij uitgeschakelde module een melding in plaats van de pagina (ook voor onderliggende pagina's). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (!(await isModuleOn("uren"))) return <ModuleOff module="uren" />;
  return children;
}
