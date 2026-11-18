/**
 * Kleine weektrend-grafieken voor Gezondheid (server-component, SVG zonder pakketten).
 * Eén reeks per grafiek in Nacht; de lopende week lichter; een doel als stippellijn.
 * Waarden staan ook als tooltip (title) op elke staaf en als tekst onder de grafiek.
 */

type Point = { label: string; value: number | null; current?: boolean };

const W = 280;
const H = 84;
const PAD_T = 14;
const PAD_B = 16;

export function TrendBars({ title, points, goal, format, goalLabel }: { title: string; points: Point[]; goal?: number | null; format: (v: number) => string; goalLabel?: string }) {
  const vals = points.map((p) => p.value ?? 0);
  const max = Math.max(...vals, goal ?? 0, 1) * 1.1;
  const slot = W / points.length;
  const bw = Math.min(22, slot - 6);
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / max);
  const cur = points.at(-1);
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="hud-mono text-[11px] uppercase tracking-[0.14em] text-steen">{title}</span>
        {cur?.value != null && <span className="hud-mono text-sm font-bold tabular-nums text-nacht">{format(cur.value)}{cur.current ? <span className="ml-1 text-[10px] font-normal text-steen">deze week</span> : null}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full" role="img" aria-label={`${title}: ${points.map((p) => `${p.label} ${p.value == null ? "geen gegevens" : format(p.value)}`).join(", ")}`}>
        <line x1={0} x2={W} y1={H - PAD_B} y2={H - PAD_B} className="stroke-lijn" strokeWidth={1} />
        {goal ? (
          <g>
            <line x1={0} x2={W} y1={y(goal)} y2={y(goal)} className="stroke-steen" strokeWidth={1} strokeDasharray="3 3" />
            <text x={0} y={y(goal) - 3} className="fill-steen text-[9px]">{goalLabel ?? `doel ${format(goal)}`}</text>
          </g>
        ) : null}
        {points.map((p, i) => {
          const x = i * slot + (slot - bw) / 2;
          const v = p.value;
          const top = v == null ? H - PAD_B : y(v);
          const h = Math.max(0, H - PAD_B - top);
          return (
            <g key={p.label}>
              {/* Raakvlak groter dan de staaf, voor de tooltip */}
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent">
                <title>{`${p.label}: ${v == null ? "geen gegevens" : format(v)}${p.current ? " (week loopt nog)" : ""}`}</title>
              </rect>
              {v != null && h > 0 && (
                <path
                  d={`M${x},${H - PAD_B} V${top + Math.min(3, h)} Q${x},${top} ${x + Math.min(3, h)},${top} H${x + bw - Math.min(3, h)} Q${x + bw},${top} ${x + bw},${top + Math.min(3, h)} V${H - PAD_B} Z`}
                  className={`fill-nacht ${p.current ? "opacity-40" : ""}`}
                  pointerEvents="none"
                />
              )}
              {(i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) && (
                <text x={i * slot + slot / 2} y={H - 3} textAnchor="middle" className="fill-steen text-[9px]">{p.label}</text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Gewicht als lijn met punten (geen staven: het gaat om het verloop, niet om de hoeveelheid). */
export function TrendLine({ title, points, goal, format }: { title: string; points: Point[]; goal?: number | null; format: (v: number) => string }) {
  const known = points.map((p, i) => ({ ...p, i })).filter((p) => p.value != null) as (Point & { i: number; value: number })[];
  const cur = known.at(-1);
  const lo = Math.min(...known.map((p) => p.value), goal ?? Infinity);
  const hi = Math.max(...known.map((p) => p.value), goal ?? -Infinity);
  const span = Math.max(hi - lo, 1);
  const slot = W / points.length;
  const x = (i: number) => i * slot + slot / 2;
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - (v - (lo - span * 0.15)) / (span * 1.3));
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="hud-mono text-[11px] uppercase tracking-[0.14em] text-steen">{title}</span>
        {cur && <span className="hud-mono text-sm font-bold tabular-nums text-nacht">{format(cur.value)}</span>}
      </figcaption>
      {known.length ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full" role="img" aria-label={`${title}: ${known.map((p) => `${p.label} ${format(p.value)}`).join(", ")}`}>
          <line x1={0} x2={W} y1={H - PAD_B} y2={H - PAD_B} className="stroke-lijn" strokeWidth={1} />
          {goal ? (
            <g>
              <line x1={0} x2={W} y1={y(goal)} y2={y(goal)} className="stroke-steen" strokeWidth={1} strokeDasharray="3 3" />
              <text x={0} y={y(goal) - 3} className="fill-steen text-[9px]">doel {format(goal)}</text>
            </g>
          ) : null}
          <polyline points={known.map((p) => `${x(p.i)},${y(p.value)}`).join(" ")} fill="none" className="stroke-nacht" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {known.map((p) => (
            <g key={p.label}>
              <circle cx={x(p.i)} cy={y(p.value)} r={4} className="fill-nacht stroke-vlak" strokeWidth={2} />
              <circle cx={x(p.i)} cy={y(p.value)} r={12} fill="transparent">
                <title>{`${p.label}: ${format(p.value)}`}</title>
              </circle>
            </g>
          ))}
          {[0, Math.floor(points.length / 2), points.length - 1].map((i) => (
            <text key={i} x={x(i)} y={H - 3} textAnchor="middle" className="fill-steen text-[9px]">{points[i].label}</text>
          ))}
        </svg>
      ) : (
        <p className="mt-6 text-xs text-steen">Nog geen gewicht binnengekomen.</p>
      )}
    </figure>
  );
}
