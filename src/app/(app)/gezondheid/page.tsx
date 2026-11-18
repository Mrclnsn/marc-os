import Link from "next/link";
import { getISOWeek, parseISO } from "date-fns";
import { PageHeader } from "@/components/brand";
import { KpiTiles, Panel, type Tile } from "@/components/cockpit";
import { TrendBars, TrendLine } from "@/components/health-charts";
import { GoalsForm, WorkoutActions, WorkoutForm } from "@/components/health-parts";
import { healthTrend, healthWeek, lastHealthImport, type HealthDay } from "@/lib/health";
import { WORKOUT_KINDS, countsAsSession, fmtMetric, fmtSleep, type MetricKey, type WorkoutKind } from "@/lib/health-shared";
import { addDaysIso, today, weekStart } from "@/lib/dates";
import { formatDuration } from "@/lib/duration";

export const dynamic = "force-dynamic";

const isoRe = /^\d{4}-\d{2}-\d{2}$/;
const dayFmt = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short" });
const dayLong = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" });
const shortFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
const whenFmt = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
const d12 = (iso: string) => new Date(`${iso}T12:00:00`);
const nf = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const v = (d: HealthDay, k: MetricKey) => d.values[k];

/**
 * Gezondheid (gesprek 9): Apple Health per dag en per week, met weektrends, trainingen en doelen.
 * Gegevens komen binnen via Health Auto Export (zie Instellingen → Apple Health).
 */
export default async function HealthPage({ searchParams }: { searchParams: Promise<{ week?: string; dag?: string }> }) {
  const sp = await searchParams;
  const t = today();
  const dag = sp.dag && isoRe.test(sp.dag) && sp.dag <= t ? sp.dag : null;
  const anchor = dag ?? (sp.week && isoRe.test(sp.week) ? sp.week : t);
  const [week, trend, last] = await Promise.all([healthWeek(anchor), healthTrend(8, anchor), lastHealthImport()]);
  const stale = last ? isStale(last.receivedAt) : false;
  const g = week.goals;
  const isThisWeek = week.start === weekStart(t);
  const selected = week.days.find((d) => d.date === (dag ?? (isThisWeek ? t : week.end))) ?? week.days[0];
  const prev = addDaysIso(week.start, -7);
  const next = addDaysIso(week.start, 7);
  const weekNo = getISOWeek(parseISO(week.start));

  const tiles: Tile[] = [
    {
      key: "sport",
      label: "Sportsessies",
      value: `${week.sessions}/${g.sessionsPerWeek}`,
      sub: week.workouts ? `${week.workouts} ${week.workouts === 1 ? "training" : "trainingen"}, ${formatDuration(week.workoutMin)} uur` : "nog geen training",
      alert: false,
    },
    { key: "stappen", label: "Stappen per dag", value: week.avgSteps == null ? "–" : nf.format(week.avgSteps), sub: g.stepsPerDay ? `${week.daysStepGoal} ${week.daysStepGoal === 1 ? "dag" : "dagen"} boven ${nf.format(g.stepsPerDay)}` : "gemiddeld" },
    { key: "slaap", label: "Slaap per nacht", value: fmtSleep(week.avgSleepMin), sub: g.sleepHours ? `${week.daysSleepGoal} ${week.daysSleepGoal === 1 ? "nacht" : "nachten"} ${fmtSleep(g.sleepHours * 60)} of meer` : "gemiddeld" },
    { key: "beweging", label: "Beweegminuten", value: week.avgExercise == null ? "–" : nf.format(week.avgExercise), sub: `per dag${g.exercisePerDay ? `, doel ${g.exercisePerDay}` : ""}` },
    {
      key: "voeding",
      label: "Gegeten per dag",
      value: week.avgIntake == null ? "–" : `${nf.format(week.avgIntake)}`,
      sub: week.avgIntake == null ? "geen voeding binnen" : `kcal · eiwit ${week.avgProtein == null ? "–" : nf.format(week.avgProtein)} g${g.kcalPerDay ? ` · doel ${nf.format(g.kcalPerDay)}` : ""}`,
    },
    {
      key: "gewicht",
      label: "Gewicht",
      value: week.weight == null ? "–" : `${nf1.format(week.weight)}`,
      sub: week.weight == null ? "geen weging" : `kg${week.weightChange != null ? ` · ${week.weightChange > 0 ? "+" : week.weightChange < 0 ? "−" : "±"}${nf1.format(Math.abs(week.weightChange))} t.o.v. vorige week` : ""}`,
    },
  ];

  const trendLabel = (s: string) => `wk ${getISOWeek(parseISO(s))}`;
  const curStart = weekStart(t);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Leven" title="Gezondheid">
        <Link href={`/gezondheid?week=${prev}`} className="btn-ghost text-sm">← Vorige</Link>
        <span className="hud-mono text-sm text-steen">
          Week {weekNo} · {shortFmt.format(d12(week.start))} tot {shortFmt.format(d12(week.end))}
        </span>
        {!isThisWeek && <Link href="/gezondheid" className="btn-ghost text-sm">Deze week</Link>}
        {next <= t && <Link href={`/gezondheid?week=${next}`} className="btn-ghost text-sm">Volgende →</Link>}
      </PageHeader>

      {!last ? (
        <div className="card p-4 text-sm">
          <p className="font-bold text-nacht">Nog geen gegevens uit Apple Health</p>
          <p className="mt-1 text-grafiet">
            Zet Health Auto Export op je iPhone aan om stappen, trainingen, slaap, gewicht en voeding elke dag hierheen te sturen. De stappen staan op{" "}
            <Link href="/instellingen#apple-health" className="underline">Instellingen → Apple Health</Link>. Een training die niet in Apple Health komt, voeg je hieronder met de hand toe.
          </p>
        </div>
      ) : (
        <p className="text-xs text-steen">
          Laatst ontvangen uit Apple Health: {whenFmt.format(last.receivedAt)}
          {stale ? " · dat is meer dan een dag geleden, kijk of Health Auto Export nog draait" : ""} ·{" "}
          <Link href="/instellingen#apple-health" className="underline">koppeling</Link>
        </p>
      )}

      <KpiTiles kpis={tiles} />

      <Panel title="Per dag" aside={<span>klik een dag voor details</span>}>
        {/* Telefoon: compacte lijst; Mac: de volledige tabel */}
        <ul className="divide-y divide-lijn md:hidden">
          {week.days
            .filter((d) => d.date <= t)
            .map((d) => {
              const on = d.date === selected.date;
              return (
                <li key={d.date}>
                  <Link href={`/gezondheid?dag=${d.date}`} className={`block px-4 py-2.5 ${on ? "bg-parel" : ""}`}>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={`text-sm ${on ? "font-bold text-nacht" : "text-grafiet"}`}>{d.date === t ? "Vandaag" : dayFmt.format(d12(d.date))}</span>
                      <span className="hud-mono text-xs tabular-nums text-steen">
                        {fmtMetric("steps", v(d, "steps"))} stappen · {fmtSleep(d.sleep?.totalMin)} slaap
                        {v(d, "intake_kcal") != null ? ` · ${fmtMetric("intake_kcal", v(d, "intake_kcal"))} kcal` : ""}
                      </span>
                    </span>
                    {d.workouts.length > 0 && <span className="mt-0.5 block truncate text-xs text-nacht">{d.workouts.map((w) => `${w.name} ${w.durationMin}′`).join(", ")}</span>}
                  </Link>
                </li>
              );
            })}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] whitespace-nowrap text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-steen">
                <th className="sticky left-0 bg-vlak px-4 py-2 font-normal">Dag</th>
                <th className="px-3 py-2 text-right font-normal">Stappen</th>
                <th className="px-3 py-2 text-right font-normal">Beweging</th>
                <th className="px-3 py-2 text-right font-normal">Actief</th>
                <th className="px-3 py-2 text-right font-normal">Slaap</th>
                <th className="px-3 py-2 font-normal">Training</th>
                <th className="px-3 py-2 text-right font-normal">Gegeten</th>
                <th className="px-3 py-2 text-right font-normal">E / K / V</th>
                <th className="px-4 py-2 text-right font-normal">Gewicht</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lijn">
              {week.days.map((d) => {
                const future = d.date > t;
                const on = d.date === selected.date;
                const steps = v(d, "steps");
                const sleepOk = d.sleep && g.sleepHours && d.sleep.totalMin >= g.sleepHours * 60;
                return (
                  <tr key={d.date} className={`${on ? "bg-parel" : ""} ${future ? "text-steen/60" : ""}`}>
                    <td className={`sticky left-0 px-4 py-2 ${on ? "bg-parel" : "bg-vlak"}`}>
                      {future ? (
                        <span>{dayFmt.format(d12(d.date))}</span>
                      ) : (
                        <Link href={`/gezondheid?dag=${d.date}`} className={`whitespace-nowrap hover:underline ${on ? "font-bold text-nacht" : "text-grafiet"}`}>
                          {d.date === t ? "Vandaag" : dayFmt.format(d12(d.date))}
                        </Link>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right ${steps != null && g.stepsPerDay && steps >= g.stepsPerDay ? "font-bold text-nacht" : ""}`}>{fmtMetric("steps", steps)}</td>
                    <td className="px-3 py-2 text-right">{v(d, "exercise") == null ? "–" : `${fmtMetric("exercise", v(d, "exercise"))} min`}</td>
                    <td className="px-3 py-2 text-right">{v(d, "active_energy") == null ? "–" : `${fmtMetric("active_energy", v(d, "active_energy"))} kcal`}</td>
                    <td className={`px-3 py-2 text-right ${sleepOk ? "font-bold text-nacht" : ""}`}>{fmtSleep(d.sleep?.totalMin)}</td>
                    <td className="max-w-[200px] truncate px-3 py-2">
                      {d.workouts.length ? d.workouts.map((w) => `${w.name} ${w.durationMin}′`).join(", ") : <span className="text-steen">–</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtMetric("intake_kcal", v(d, "intake_kcal"))}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-steen">
                      {v(d, "protein") == null && v(d, "carbs") == null ? "–" : `${fmtMetric("protein", v(d, "protein"))} / ${fmtMetric("carbs", v(d, "carbs"))} / ${fmtMetric("fat", v(d, "fat"))}`}
                    </td>
                    <td className="px-4 py-2 text-right">{v(d, "weight") == null ? "" : fmtMetric("weight", v(d, "weight"))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hidden border-t border-lijn px-4 py-2 text-xs text-steen md:block">
          Vet = doel gehaald. E / K / V = eiwit, koolhydraten en vet in gram. Gemiddelden bovenaan tellen vandaag pas mee als de dag voorbij is (behalve slaap).
        </p>
      </Panel>

      <DayDetail day={selected} t={t} goals={g} />

      <Panel title="Laatste 8 weken">
        <div className="grid gap-6 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <TrendBars
            title="Sportsessies"
            points={trend.map((w) => ({ label: trendLabel(w.start), value: w.sessions, current: w.start === curStart }))}
            goal={g.sessionsPerWeek || null}
            format={(x) => nf.format(x)}
          />
          <TrendBars
            title="Stappen per dag"
            points={trend.map((w) => ({ label: trendLabel(w.start), value: w.avgSteps, current: w.start === curStart }))}
            goal={g.stepsPerDay || null}
            format={(x) => nf.format(x)}
          />
          <TrendBars
            title="Slaap per nacht"
            points={trend.map((w) => ({ label: trendLabel(w.start), value: w.avgSleepMin, current: w.start === curStart }))}
            goal={g.sleepHours ? g.sleepHours * 60 : null}
            format={(x) => fmtSleep(x)}
          />
          <TrendLine title="Gewicht (kg)" points={trend.map((w) => ({ label: trendLabel(w.start), value: w.weight }))} goal={g.weightKg} format={(x) => nf1.format(x)} />
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Training toevoegen" aside={<span>als hij niet via Apple Health komt</span>}>
          <div className="p-4">
            <WorkoutForm date={t} />
          </div>
        </Panel>
        <Panel title="Doelen">
          <div className="p-4">
            <GoalsForm goals={g} />
          </div>
        </Panel>
      </div>

      <p className="text-xs text-steen">
        Gewoontes automatisch laten afvinken (bijv. &quot;Sporten&quot; bij een training, &quot;8.000 stappen&quot;): stel het in bij de gewoonte op{" "}
        <Link href="/planning/gewoontes" className="underline">Planning → Gewoontes</Link>.
      </p>
    </div>
  );
}

/** Meer dan 36 uur geen zending (buiten het component, zodat de weergave zuiver blijft). */
function isStale(at: Date) {
  return Date.now() - at.getTime() > 36 * 3600 * 1000;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-steen">{label}</dt>
      <dd className="hud-mono text-lg font-bold tabular-nums text-nacht">{value}</dd>
      {sub && <dd className="text-[11px] text-steen">{sub}</dd>}
    </div>
  );
}

/** Verhouding als dunne balk (bijv. slaapfasen of macro's), met de waarden ernaast in tekst. */
function Split({ parts }: { parts: { label: string; value: number; tone: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return null;
  return (
    <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-[2px]" aria-hidden>
      {parts.filter((p) => p.value > 0).map((p) => (
        <span key={p.label} className={p.tone} style={{ width: `${(p.value / total) * 100}%` }} title={p.label} />
      ))}
    </div>
  );
}

function DayDetail({ day, t, goals }: { day: HealthDay; t: string; goals: Awaited<ReturnType<typeof healthWeek>>["goals"] }) {
  const s = day.sleep;
  const kcal = v(day, "intake_kcal");
  const prot = v(day, "protein");
  const carbs = v(day, "carbs");
  const fat = v(day, "fat");
  // Energie uit macro's: eiwit en koolhydraten 4 kcal/g, vet 9 kcal/g
  const macroKcal = [(prot ?? 0) * 4, (carbs ?? 0) * 4, (fat ?? 0) * 9];
  return (
    <Panel title={day.date === t ? "Vandaag" : dayLong.format(d12(day.date))} aside={day.hasData ? undefined : <span>geen gegevens</span>}>
      <div className="grid gap-6 p-4 md:grid-cols-3">
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-nacht">Beweging</h3>
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Stappen" value={fmtMetric("steps", v(day, "steps"))} sub={goals.stepsPerDay ? `doel ${nf.format(goals.stepsPerDay)}` : undefined} />
            <Stat label="Beweegminuten" value={fmtMetric("exercise", v(day, "exercise"))} sub={goals.exercisePerDay ? `doel ${goals.exercisePerDay}` : undefined} />
            <Stat label="Actieve energie" value={v(day, "active_energy") == null ? "–" : `${fmtMetric("active_energy", v(day, "active_energy"))}`} sub="kcal" />
            <Stat label="Afstand lopen" value={v(day, "distance") == null ? "–" : fmtMetric("distance", v(day, "distance"))} sub="km" />
            {v(day, "resting_hr") != null && <Stat label="Rusthartslag" value={fmtMetric("resting_hr", v(day, "resting_hr"))} sub="slagen per minuut" />}
            {v(day, "weight") != null && <Stat label="Gewicht" value={fmtMetric("weight", v(day, "weight"))} sub={`kg${v(day, "body_fat") != null ? ` · ${fmtMetric("body_fat", v(day, "body_fat"))}% vet` : ""}`} />}
          </dl>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-nacht">Slaap</h3>
          {s ? (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Stat label="Geslapen" value={fmtSleep(s.totalMin)} sub={goals.sleepHours ? `doel ${fmtSleep(goals.sleepHours * 60)}` : undefined} />
                <Stat label="Van tot" value={s.sleepStart && s.sleepEnd ? `${timeFmt.format(s.sleepStart)}–${timeFmt.format(s.sleepEnd)}` : "–"} sub={s.inBedMin ? `${fmtSleep(s.inBedMin)} in bed` : undefined} />
              </dl>
              {(s.deepMin || s.remMin || s.coreMin) && (
                <div className="space-y-1.5">
                  <Split
                    parts={[
                      { label: "Diep", value: s.deepMin ?? 0, tone: "bg-nacht" },
                      { label: "REM", value: s.remMin ?? 0, tone: "bg-nacht/60" },
                      { label: "Kern", value: s.coreMin ?? 0, tone: "bg-nacht/30" },
                      { label: "Wakker", value: s.awakeMin ?? 0, tone: "bg-lijn" },
                    ]}
                  />
                  <p className="text-[11px] text-steen">
                    Diep {fmtSleep(s.deepMin)} · REM {fmtSleep(s.remMin)} · kern {fmtSleep(s.coreMin)}
                    {s.awakeMin ? ` · wakker ${fmtSleep(s.awakeMin)}` : ""}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-steen">Geen slaap binnengekomen voor deze nacht.</p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-nacht">Voeding</h3>
          {kcal != null || prot != null ? (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Stat label="Gegeten" value={fmtMetric("intake_kcal", kcal)} sub={`kcal${goals.kcalPerDay ? ` · doel ${nf.format(goals.kcalPerDay)}` : ""}`} />
                <Stat label="Eiwit" value={fmtMetric("protein", prot)} sub={`g${goals.proteinPerDay ? ` · doel ${goals.proteinPerDay}` : ""}`} />
                <Stat label="Koolhydraten" value={fmtMetric("carbs", carbs)} sub="g" />
                <Stat label="Vet" value={fmtMetric("fat", fat)} sub={v(day, "fiber") != null ? `g · vezels ${fmtMetric("fiber", v(day, "fiber"))} g` : "g"} />
              </dl>
              <Split
                parts={[
                  { label: "Eiwit", value: macroKcal[0], tone: "bg-nacht" },
                  { label: "Koolhydraten", value: macroKcal[1], tone: "bg-nacht/55" },
                  { label: "Vet", value: macroKcal[2], tone: "bg-nacht/25" },
                ]}
              />
              {v(day, "water") != null && <p className="text-[11px] text-steen">Water {nf.format(v(day, "water")!)} ml</p>}
            </>
          ) : (
            <p className="text-sm text-steen">Geen voeding binnengekomen. Foodvisor schrijft naar Apple Health als je dat in Foodvisor aanzet.</p>
          )}
        </section>
      </div>

      <div className="border-t border-lijn">
        <h3 className="px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-[0.12em] text-nacht">Trainingen</h3>
        {day.workouts.length ? (
          <ul className="divide-y divide-lijn">
            {day.workouts.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="font-bold text-nacht">
                    {w.name}
                    {!countsAsSession(w) && <span className="ml-2 text-[11px] font-normal text-steen">telt niet als sportsessie</span>}
                  </p>
                  <p className="text-xs text-steen">
                    {[
                      w.startAt ? timeFmt.format(w.startAt) : null,
                      `${w.durationMin} min`,
                      w.activeKcal ? `${nf.format(w.activeKcal)} kcal` : null,
                      w.distanceKm ? `${nf1.format(w.distanceKm)} km` : null,
                      w.avgHr ? `gem. ${w.avgHr} bpm` : null,
                      WORKOUT_KINDS[w.kind as WorkoutKind] ?? w.kind,
                      w.source === "health" ? `Apple Health${w.device ? ` (${w.device})` : ""}` : "met de hand",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <WorkoutActions id={w.id} kind={w.kind} name={w.name} fromHealth={w.source === "health"} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-3 text-sm text-steen">Geen training op deze dag.</p>
        )}
      </div>
    </Panel>
  );
}
