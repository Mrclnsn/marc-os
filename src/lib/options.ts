import "server-only";
import { listClients, listProjects } from "./data";
import type { Option } from "@/components/forms";

/** Keuzelijsten voor formulieren. */
export async function getOptions(): Promise<{ clients: Option[]; projects: Option[] }> {
  const [c, p] = await Promise.all([listClients(), listProjects()]);
  return {
    clients: c.map((r) => ({ id: r.client.id, name: r.client.name })),
    projects: p.map((r) => ({
      id: r.project.id,
      name: r.clientName ? `${r.project.name} (${r.clientName})` : r.project.name,
      clientId: r.project.clientId,
    })),
  };
}
