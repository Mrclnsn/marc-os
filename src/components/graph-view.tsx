"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "@/lib/brain";

type Sim = { x: number; y: number; vx: number; vy: number; fixed: boolean };

const KIND_LABEL: Record<GraphNode["kind"], string> = { note: "Notitie", source: "Bron", client: "Klant", project: "Project", missing: "Bestaat nog niet" };

/**
 * Grafiek van notities, bronnen, klanten en projecten (zoals in Obsidian), zonder extra pakketten.
 * Krachtenmodel in de browser; slepen, pannen, zoomen (ook knijpen op de telefoon), aantikken opent het item.
 * Met focusId toont hij alleen de buurt van één item (lokale grafiek).
 */
export function GraphView({
  nodes: allNodes,
  edges: allEdges,
  focusId,
  depth = 2,
  height = 560,
  controls = true,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusId?: string;
  depth?: number;
  height?: number;
  controls?: boolean;
}) {
  const router = useRouter();
  const [showStructure, setShowStructure] = useState(true);
  const [showMissing, setShowMissing] = useState(true);
  const [showOrphans, setShowOrphans] = useState(!focusId);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);

  /* Welke knopen en lijnen zichtbaar zijn */
  const { nodes, edges } = useMemo(() => {
    let es = allEdges.filter((e) => showStructure || e.kind === "link");
    let ids = new Set(allNodes.map((n) => n.id));
    if (!showMissing) ids = new Set([...ids].filter((id) => !id.startsWith("missing:")));
    es = es.filter((e) => ids.has(e.source) && ids.has(e.target));
    if (focusId) {
      const near = new Set([focusId]);
      let frontier = [focusId];
      for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const e of es) {
          for (const [a, b] of [[e.source, e.target], [e.target, e.source]] as const)
            if (frontier.includes(a) && !near.has(b)) {
              near.add(b);
              next.push(b);
            }
        }
        frontier = next;
      }
      ids = new Set([...ids].filter((id) => near.has(id)));
      es = es.filter((e) => ids.has(e.source) && ids.has(e.target));
    }
    const deg = new Map<string, number>();
    for (const e of es) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    const ns = allNodes
      .filter((n) => ids.has(n.id))
      .filter((n) => n.id === focusId || (deg.get(n.id) ?? 0) > 0 || (showOrphans && (n.kind === "note" || n.kind === "source")))
      .map((n) => ({ ...n, degree: deg.get(n.id) ?? 0 }));
    const keep = new Set(ns.map((n) => n.id));
    return { nodes: ns, edges: es.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  }, [allNodes, allEdges, showStructure, showMissing, showOrphans, focusId, depth]);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [edges]);

  /* Simulatie */
  const sim = useRef(new Map<string, Sim>());
  const alpha = useRef(1);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const snap = () => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const [k, v] of sim.current) out[k] = { x: v.x, y: v.y };
    setPos(out);
  };
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ w: 800, h: height });
  const userMoved = useRef(false);
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  /** Alles in beeld: zoom en schuif zodat alle knopen passen. */
  const fit = () => {
    const pts = nodes.map((n) => sim.current.get(n.id)).filter((p): p is Sim => !!p);
    if (!pts.length) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const { w, h } = sizeRef.current;
    const k = Math.min(1.6, Math.max(0.2, Math.min((w - 80) / Math.max(1, maxX - minX), (h - 80) / Math.max(1, maxY - minY))));
    setView({ k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k });
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  useEffect(() => {
    const m = sim.current;
    const r = Math.max(60, Math.sqrt(nodes.length) * 28);
    nodes.forEach((n, i) => {
      if (m.has(n.id)) return;
      // Nieuwe knoop: naast een al geplaatste buur, anders op een spiraal
      const nb = [...(neighbours.get(n.id) ?? [])].map((id) => m.get(id)).find(Boolean);
      const a = i * 2.399963;
      const d = r * Math.sqrt((i + 0.5) / Math.max(1, nodes.length));
      m.set(n.id, nb ? { x: nb.x + Math.cos(a) * 20, y: nb.y + Math.sin(a) * 20, vx: 0, vy: 0, fixed: false } : { x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0, fixed: false });
    });
    if (focusId && m.get(focusId)) Object.assign(m.get(focusId)!, { x: 0, y: 0 });
    alpha.current = 1;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let frames = 0;
    const tick = () => {
      if (!userMoved.current && frames++ % 6 === 0) fit();
      step(nodes, edges, m, alpha.current, focusId);
      alpha.current *= 0.975;
      if (reduce) {
        while (alpha.current > 0.02) {
          step(nodes, edges, m, alpha.current, focusId);
          alpha.current *= 0.975;
        }
      }
      snap();
      if (alpha.current > 0.02) raf = requestAnimationFrame(tick);
      else if (!userMoved.current) fit();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fit leest alleen refs en de huidige knopen
  }, [nodes, edges, neighbours, focusId]);

  const reheat = () => {
    if (alpha.current > 0.05) return;
    alpha.current = 0.4;
    const m = sim.current;
    const loop = () => {
      step(nodes, edges, m, alpha.current, focusId);
      alpha.current *= 0.96;
      snap();
      if (alpha.current > 0.02) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };

  /* Slepen, pannen, zoomen */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: string | null; startX: number; startY: number; moved: boolean; pinch?: number } | null>(null);

  const toWorld = (cx: number, cy: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (cx - rect.left - size.w / 2 - view.x) / view.k, y: (cy - rect.top - size.h / 2 - view.y) / view.k };
  };

  const onPointerDown = (e: React.PointerEvent, id: string | null) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { id: null, startX: 0, startY: 0, moved: true, pinch: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    drag.current = { id, startX: e.clientX, startY: e.clientY, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !drag.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (d.pinch && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.min(4, Math.max(0.2, view.k * (dist / d.pinch)));
      d.pinch = dist;
      userMoved.current = true;
      setView((v) => ({ ...v, k }));
      return;
    }
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.id) {
      const s = sim.current.get(d.id);
      if (s) {
        const w = toWorld(e.clientX, e.clientY);
        Object.assign(s, { x: w.x, y: w.y, vx: 0, vy: 0, fixed: true });
        reheat();
        snap();
      }
    } else {
      userMoved.current = true;
      setView((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (!d) return;
    if (d.id) {
      const s = sim.current.get(d.id);
      if (s) s.fixed = false;
      if (!d.moved) {
        const n = nodes.find((x) => x.id === d.id);
        if (n) router.push(n.href);
      }
    }
    if (pointers.current.size === 0) drag.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    userMoved.current = true;
    const k = Math.min(4, Math.max(0.2, view.k * Math.exp(-e.deltaY * 0.0015)));
    const rect = svgRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left - size.w / 2;
    const py = e.clientY - rect.top - size.h / 2;
    setView((v) => ({ k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }));
  };

  // Wielzoom zonder dat de pagina meescrolt
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, []);

  /* Tekenen */
  const q = query.trim().toLowerCase();
  const match = (n: GraphNode) => !q || n.title.toLowerCase().includes(q);
  const active = hover ?? (focusId && !q ? focusId : null);
  const lit = (id: string) => !active || id === active || neighbours.get(active)?.has(id);
  const showLabel = (n: GraphNode) => nodes.length <= 40 || view.k > 1.4 || n.degree >= 4 || n.id === active || (active && neighbours.get(active)?.has(n.id)) || (q && match(n)) || n.id === focusId;
  const radius = (n: GraphNode) => (n.kind === "client" ? 7 : n.kind === "project" ? 6 : 4) + Math.min(8, Math.sqrt(n.degree) * 1.6);

  return (
    <div className="space-y-2">
      {controls && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-grafiet">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Zoek in de grafiek" className="input py-1 text-xs" />
          <Toggle on={showStructure} set={setShowStructure}>Koppelingen klant/project</Toggle>
          <Toggle on={showMissing} set={setShowMissing}>Nog niet bestaand</Toggle>
          <Toggle on={showOrphans} set={setShowOrphans}>Losse notities</Toggle>
          <button type="button" className="btn-ghost text-xs" onClick={() => {
              userMoved.current = false;
              fit();
            }}>Alles in beeld</button>
          <span className="ml-auto text-steen">{nodes.length} items · {edges.length} verbindingen</span>
        </div>
      )}
      <div className="card relative overflow-hidden" style={{ height }}>
        <svg
          ref={svgRef}
          className="h-full w-full touch-none select-none"
          onPointerDown={(e) => onPointerDown(e, null)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          role="img"
          aria-label="Grafiek van notities en verbindingen"
        >
          <g transform={`translate(${size.w / 2 + view.x},${size.h / 2 + view.y}) scale(${view.k})`}>
            {edges.map((e) => {
              const a = pos[e.source];
              const b = pos[e.target];
              if (!a || !b) return null;
              const on = !active || e.source === active || e.target === active;
              return (
                <line
                  key={`${e.source}|${e.target}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={e.kind === "link" ? "stroke-steen" : "stroke-steen"}
                  strokeWidth={(e.kind === "link" ? 1.2 : 0.8) / Math.sqrt(view.k)}
                  strokeDasharray={e.kind === "structure" ? "3 3" : undefined}
                  opacity={on ? (e.kind === "link" ? 0.9 : 0.5) : 0.12}
                />
              );
            })}
            {nodes.map((n) => {
              const s = pos[n.id];
              if (!s) return null;
              const r = radius(n);
              const dim = !lit(n.id) || (q && !match(n));
              return (
                <g
                  key={n.id}
                  transform={`translate(${s.x},${s.y})`}
                  opacity={dim ? 0.18 : 1}
                  className="cursor-pointer"
                  onPointerDown={(e) => onPointerDown(e, n.id)}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                >
                  <title>{`${KIND_LABEL[n.kind]}: ${n.title}`}</title>
                  <Shape kind={n.kind} r={r} focus={n.id === focusId} />
                  {showLabel(n) && (
                    <text y={r + 11 / view.k} textAnchor="middle" className="fill-grafiet" style={{ fontSize: 11 / Math.sqrt(view.k), paintOrder: "stroke", stroke: "var(--vlak)", strokeWidth: 3 / view.k }}>
                      {n.title.length > 32 ? `${n.title.slice(0, 30)}…` : n.title}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        {nodes.length === 0 && <p className="absolute inset-0 flex items-center justify-center text-sm text-steen">Nog niets om te tonen. Schrijf [[links]] in je notities.</p>}
        {controls && (
          <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-3 rounded-sm bg-vlak/90 px-2 py-1 text-[11px] text-grafiet">
            {(["note", "source", "client", "project", "missing"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1">
                <svg width="14" height="14" viewBox="-7 -7 14 14"><Shape kind={k} r={k === "client" ? 5 : 4} /></svg>
                {KIND_LABEL[k]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Shape({ kind, r, focus }: { kind: GraphNode["kind"]; r: number; focus?: boolean }) {
  const ring = focus ? <circle r={r + 4} className="fill-none stroke-nacht" strokeWidth={1.5} /> : null;
  switch (kind) {
    case "client":
      return <>{ring}<rect x={-r} y={-r} width={r * 2} height={r * 2} rx={1} className="fill-nacht" /></>;
    case "project":
      return <>{ring}<rect x={-r * 0.8} y={-r * 0.8} width={r * 1.6} height={r * 1.6} transform="rotate(45)" className="fill-vlak stroke-nacht" strokeWidth={1.8} /></>;
    case "source":
      return <>{ring}<circle r={r} className="fill-vlak stroke-nacht" strokeWidth={1.8} /></>;
    case "missing":
      return <>{ring}<circle r={r} className="fill-none stroke-steen" strokeWidth={1.2} strokeDasharray="2 2" /></>;
    default:
      return <>{ring}<circle r={r} className="fill-nacht" /></>;
  }
}

function Toggle({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="accent-[var(--nacht)]" />
      {children}
    </label>
  );
}

/** Eén stap van het krachtenmodel: afstoten, veren langs lijnen, zachte trek naar het midden. */
function step(nodes: GraphNode[], edges: GraphEdge[], m: Map<string, Sim>, alpha: number, focusId?: string) {
  const list = nodes.map((n) => m.get(n.id)!).filter(Boolean);
  const n = list.length;
  // Afstoten (bij veel knopen een steekproef per knoop, zodat het vlot blijft)
  const sample = n > 400 ? 120 : n;
  for (let i = 0; i < n; i++) {
    const a = list[i];
    for (let s = 0; s < sample; s++) {
      const j = sample === n ? s : Math.floor(Math.random() * n);
      if (j <= i && sample === n) continue;
      const b = list[j];
      if (a === b) continue;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = 0.25;
      }
      if (d2 > 160_000) continue;
      const f = ((sample === n ? 900 : (900 * n) / sample) * alpha) / d2;
      const fx = dx * f;
      const fy = dy * f;
      a.vx += fx;
      a.vy += fy;
      if (sample === n) {
        b.vx -= fx;
        b.vy -= fy;
      }
    }
  }
  // Veren
  for (const e of edges) {
    const a = m.get(e.source);
    const b = m.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const rest = e.kind === "link" ? 55 : 75;
    const f = ((d - rest) / d) * 0.06 * alpha;
    a.vx += dx * f;
    a.vy += dy * f;
    b.vx -= dx * f;
    b.vy -= dy * f;
  }
  // Naar het midden en bewegen
  for (const node of nodes) {
    const s = m.get(node.id);
    if (!s) continue;
    if (s.fixed || node.id === focusId) {
      s.vx = s.vy = 0;
      continue;
    }
    s.vx -= s.x * 0.004 * alpha;
    s.vy -= s.y * 0.004 * alpha;
    s.vx *= 0.6;
    s.vy *= 0.6;
    s.x += Math.max(-30, Math.min(30, s.vx));
    s.y += Math.max(-30, Math.min(30, s.vy));
  }
}
