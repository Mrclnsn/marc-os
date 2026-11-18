import { PageHeader } from "@/components/brand";
import { BrainTabs } from "@/components/brain-parts";
import { GraphView } from "@/components/graph-view";
import { getGraph } from "@/lib/data";

export default async function GraphPage() {
  const graph = await getGraph();
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Second brain" title="Grafiek" />
      <BrainTabs active="grafiek" />
      <p className="-mt-2 max-w-2xl text-sm text-steen">
        Notities, bronnen, klanten en projecten met hun verbindingen. Doorgetrokken lijnen zijn [[links]], stippellijnen de koppelingen in de app (notitie bij een klant of project). Tik op een item om het te openen, sleep om te verplaatsen, knijp of scroll om te zoomen.
      </p>
      <GraphView nodes={graph.nodes} edges={graph.edges} height={640} />
    </div>
  );
}
