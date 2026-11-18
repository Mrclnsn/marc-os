/**
 * Gezondheid (gesprek 9): metingen, soorten training en het lezen van de JSON van Health Auto Export.
 * Zonder database, zodat het ook in de browser en in tests te gebruiken is.
 *
 * Health Auto Export (iPhone-app) stuurt Apple Health-gegevens als JSON naar een REST API:
 *   { "data": { "metrics": [ { "name": "step_count", "units": "count", "data": [ { "date": "2026-11-18 00:00:00 +0100", "qty": 8123, "source": "iPhone" } ] } ],
 *               "workouts": [ { "id": "...", "name": "Traditional Strength Training", "start": "...", "end": "...", "duration": 3600,
 *                               "activeEnergyBurned": { "qty": 310, "units": "kcal" }, "distance": { "qty": 0, "units": "km" }, ... } ] } }
 * Slaap ("sleep_analysis") komt per nacht (totalSleep, deep, rem, core, awake, inBed in uren) of per fase (startDate, endDate, value, qty).
 * We lezen ruim: velden uit oudere en nieuwere versies van de app, kJ of kcal, kg of lb.
 */

/* ---------------- Metingen ---------------- */

export type MetricKey =
  | "steps"
  | "active_energy"
  | "basal_energy"
  | "exercise"
  | "distance"
  | "resting_hr"
  | "weight"
  | "body_fat"
  | "intake_kcal"
  | "protein"
  | "carbs"
  | "fat"
  | "fiber"
  | "water";

type Agg = "sum" | "avg" | "last";

export const METRICS: Record<MetricKey, { label: string; unit: string; agg: Agg; decimals: number }> = {
  steps: { label: "Stappen", unit: "", agg: "sum", decimals: 0 },
  active_energy: { label: "Actieve energie", unit: "kcal", agg: "sum", decimals: 0 },
  basal_energy: { label: "Rustenergie", unit: "kcal", agg: "sum", decimals: 0 },
  exercise: { label: "Beweegminuten", unit: "min", agg: "sum", decimals: 0 },
  distance: { label: "Afstand lopen", unit: "km", agg: "sum", decimals: 1 },
  resting_hr: { label: "Rusthartslag", unit: "bpm", agg: "avg", decimals: 0 },
  weight: { label: "Gewicht", unit: "kg", agg: "last", decimals: 1 },
  body_fat: { label: "Vetpercentage", unit: "%", agg: "last", decimals: 1 },
  intake_kcal: { label: "Gegeten", unit: "kcal", agg: "sum", decimals: 0 },
  protein: { label: "Eiwit", unit: "g", agg: "sum", decimals: 0 },
  carbs: { label: "Koolhydraten", unit: "g", agg: "sum", decimals: 0 },
  fat: { label: "Vet", unit: "g", agg: "sum", decimals: 0 },
  fiber: { label: "Vezels", unit: "g", agg: "sum", decimals: 0 },
  water: { label: "Water", unit: "ml", agg: "sum", decimals: 0 },
};

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

/** Namen zoals Health Auto Export ze stuurt (kleine letters, underscores), plus een paar varianten. */
const HAE_NAMES: Record<string, MetricKey> = {
  step_count: "steps",
  steps: "steps",
  active_energy: "active_energy",
  active_energy_burned: "active_energy",
  basal_energy_burned: "basal_energy",
  resting_energy: "basal_energy",
  apple_exercise_time: "exercise",
  exercise_time: "exercise",
  walking_running_distance: "distance",
  distance_walking_running: "distance",
  resting_heart_rate: "resting_hr",
  weight_body_mass: "weight",
  body_mass: "weight",
  weight: "weight",
  body_fat_percentage: "body_fat",
  dietary_energy: "intake_kcal",
  dietary_energy_consumed: "intake_kcal",
  protein: "protein",
  dietary_protein: "protein",
  carbohydrates: "carbs",
  dietary_carbohydrates: "carbs",
  total_fat: "fat",
  dietary_fat_total: "fat",
  fiber: "fiber",
  dietary_fiber: "fiber",
  dietary_water: "water",
  water: "water",
};

/** Omrekenen naar de vaste eenheid van de meting. null = eenheid onbekend, waarde overslaan. */
function convert(key: MetricKey, qty: number, units: string): number | null {
  const u = (units || "").toLowerCase().replace(/\s/g, "");
  const target = METRICS[key].unit;
  if (target === "kcal") {
    if (u === "kj") return qty / 4.184;
    if (u === "" || u === "kcal" || u === "cal" || u === "calories") return qty;
    return null;
  }
  if (target === "kg") {
    if (u === "lb" || u === "lbs") return qty * 0.45359237;
    if (u === "g") return qty / 1000;
    if (u === "st") return qty * 6.35029318;
    return u === "" || u === "kg" ? qty : null;
  }
  if (target === "ml") {
    if (u === "l") return qty * 1000;
    if (u === "fl_oz_us" || u === "floz" || u === "fl_oz") return qty * 29.5735;
    if (u === "cup_us") return qty * 236.588;
    return u === "" || u === "ml" ? qty : null;
  }
  if (target === "km") {
    if (u === "mi") return qty * 1.609344;
    if (u === "m") return qty / 1000;
    return u === "" || u === "km" ? qty : null;
  }
  if (target === "g") {
    if (u === "mg") return qty / 1000;
    if (u === "oz") return qty * 28.3495;
    return u === "" || u === "g" ? qty : null;
  }
  if (target === "min") {
    if (u === "s" || u === "sec") return qty / 60;
    if (u === "hr" || u === "h") return qty * 60;
    return qty;
  }
  if (target === "%") return u === "" && qty <= 1 ? qty * 100 : qty;
  return qty;
}

/* ---------------- Datums ---------------- */

const TZ = "Europe/Amsterdam";
const localDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

/**
 * "2026-11-18 07:30:00 +0100" (Health Auto Export), ISO met tijdzone, of alleen "2026-11-18".
 * date = de datum op de klok van de telefoon (de tijd in de tekst), at = het echte tijdstip,
 * clock = minuten sinds middernacht op die klok (voor slaap en de daggrens).
 */
export function parseHealthDate(raw: unknown): { date: string; at: Date; clock: number } | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!m) return null;
  const [, day, hh, mm, ss, zone] = m;
  if (!hh) return { date: day, at: new Date(`${day}T12:00:00Z`), clock: 0 };
  const iso = `${day}T${hh}:${mm}:${ss ?? "00"}${zone ? (zone === "Z" ? "Z" : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone) : ""}`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  if (zone === "Z") {
    // UTC: datum en klok in Nederlandse tijd
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    const mi = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return { date: localDate(at), at, clock: h * 60 + mi };
  }
  if (!zone) {
    // Zonder tijdzone: lezen als Nederlandse tijd (benadering via de huidige verschuiving)
    const guess = new Date(`${iso}Z`);
    const offset = new Date(guess.toLocaleString("en-US", { timeZone: TZ })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
    return { date: day, at: new Date(guess.getTime() - offset), clock: Number(hh) * 60 + Number(mm) };
  }
  return { date: day, at, clock: Number(hh) * 60 + Number(mm) };
}

/** Datum van een nacht: wie na 18:00 stopt met slapen (dutje 's avonds, begin van de nacht) telt mee voor de volgende dag. */
export function nightDate(end: { date: string; clock: number }): string {
  if (end.clock < 18 * 60) return end.date;
  const d = new Date(`${end.date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* ---------------- Trainingen ---------------- */

export const WORKOUT_KINDS = {
  kracht: "Kracht",
  cardio: "Cardio",
  hardlopen: "Hardlopen",
  fietsen: "Fietsen",
  wandelen: "Wandelen",
  zwemmen: "Zwemmen",
  yoga: "Yoga en mobiliteit",
  sport: "Sport (bal, racket)",
  overig: "Overig",
} as const;
export type WorkoutKind = keyof typeof WORKOUT_KINDS;
export const WORKOUT_KIND_KEYS = Object.keys(WORKOUT_KINDS) as WorkoutKind[];

const KIND_RULES: [RegExp, WorkoutKind][] = [
  [/strength|kracht|weight|gewicht|fitness|core|functional|bodyweight|gym|virtuagym/i, "kracht"],
  [/run|hardlo|jog/i, "hardlopen"],
  [/cycl|bike|biking|fiets|spin/i, "fietsen"],
  [/walk|wandel|hik/i, "wandelen"],
  [/swim|zwem/i, "zwemmen"],
  [/yoga|pilates|flexib|stretch|mobil|mind and body|tai chi|cooldown/i, "yoga"],
  [/hiit|interval|cardio|ellip|row|roei|stair|step training|cross|dance|kickbox|box|jump|mixed/i, "cardio"],
  [/hand|soccer|voetbal|football|tennis|padel|badminton|squash|basket|volley|hockey|golf|table tennis|racquet|sport/i, "sport"],
];

/** Soort training uit de naam (Engels uit Apple Health, of Nederlands bij handmatig). */
export function workoutKind(name: string): WorkoutKind {
  for (const [re, kind] of KIND_RULES) if (re.test(name)) return kind;
  return "overig";
}

/** Nederlandse naam voor de bekendste Apple Health-trainingen; anders de naam zoals hij binnenkomt. */
const NL_NAMES: Record<string, string> = {
  "traditional strength training": "Krachttraining",
  "functional strength training": "Functionele krachttraining",
  "core training": "Core-training",
  "high intensity interval training": "HIIT",
  running: "Hardlopen",
  "outdoor run": "Hardlopen buiten",
  "indoor run": "Hardlopen binnen",
  cycling: "Fietsen",
  "outdoor cycle": "Fietsen buiten",
  "indoor cycle": "Fietsen binnen",
  walking: "Wandelen",
  "outdoor walk": "Wandelen",
  "indoor walk": "Wandelen binnen",
  hiking: "Hiken",
  swimming: "Zwemmen",
  "pool swim": "Zwemmen (bad)",
  yoga: "Yoga",
  pilates: "Pilates",
  elliptical: "Crosstrainer",
  rowing: "Roeien",
  "mixed cardio": "Cardio",
  "cross training": "Crosstraining",
  handball: "Handbal",
  soccer: "Voetbal",
  tennis: "Tennis",
  "padel tennis": "Padel",
  cooldown: "Cooldown",
  flexibility: "Mobiliteit",
  other: "Overig",
};
export function workoutName(name: string): string {
  return NL_NAMES[name.trim().toLowerCase()] ?? name.trim();
}

/** Telt een training mee als sportsessie? Wandelingen en korte trainingen (onder 10 minuten) niet. */
export function countsAsSession(w: { kind: string; durationMin: number }): boolean {
  return w.kind !== "wandelen" && w.durationMin >= 10;
}

/* ---------------- Doelen ---------------- */

export type HealthGoals = {
  /** Sportsessies per week (trainingen behalve wandelingen, vanaf 10 minuten) */
  sessionsPerWeek: number;
  stepsPerDay: number;
  exercisePerDay: number;
  sleepHours: number;
  /** Voeding; leeg = geen doel */
  kcalPerDay: number | null;
  proteinPerDay: number | null;
  /** Streefgewicht; leeg = geen doel */
  weightKg: number | null;
};

export const DEFAULT_HEALTH_GOALS: HealthGoals = {
  sessionsPerWeek: 4,
  stepsPerDay: 8000,
  exercisePerDay: 30,
  sleepHours: 7.5,
  kcalPerDay: null,
  proteinPerDay: null,
  weightKg: null,
};

/* ---------------- Automatisch afvinken ---------------- */

export const HEALTH_RULE_METRICS = {
  workout: { label: "Training", unit: "training(en)", hint: "aantal trainingen op die dag" },
  steps: { label: "Stappen", unit: "stappen", hint: "stappen op die dag" },
  exercise: { label: "Beweegminuten", unit: "minuten", hint: "Apple-beweegminuten op die dag" },
  active_energy: { label: "Actieve energie", unit: "kcal", hint: "actieve kcal op die dag" },
  sleep: { label: "Slaap", unit: "uur", hint: "uren slaap in de nacht ervoor" },
} as const;
export type HealthRuleMetric = keyof typeof HEALTH_RULE_METRICS;

export function healthRuleLabel(r: { metric: HealthRuleMetric; min: number; kind?: string | null; minMinutes?: number | null } | null | undefined): string | null {
  if (!r) return null;
  const nf = new Intl.NumberFormat("nl-NL");
  if (r.metric === "workout") {
    const kind = r.kind && r.kind in WORKOUT_KINDS ? WORKOUT_KINDS[r.kind as WorkoutKind].toLowerCase() : null;
    const n = r.min > 1 ? `${r.min} trainingen` : "een training";
    return `bij ${n}${kind ? ` (${kind})` : ""}${r.minMinutes ? ` van minstens ${r.minMinutes} min` : ""}`;
  }
  const m = HEALTH_RULE_METRICS[r.metric];
  return `bij minstens ${nf.format(r.min)} ${m.unit}${r.metric === "sleep" ? " slaap" : ""}`;
}

/* ---------------- Health Auto Export lezen ---------------- */

export type ParsedSample = { metric: MetricKey; date: string; at: Date; qty: number; unit: string; source: string; dayLevel: boolean };
export type ParsedSleep = {
  date: string;
  totalMin: number;
  deepMin: number | null;
  remMin: number | null;
  coreMin: number | null;
  awakeMin: number | null;
  inBedMin: number | null;
  sleepStart: Date | null;
  sleepEnd: Date | null;
  source: string | null;
};
export type ParsedWorkout = {
  externalId: string;
  name: string;
  kind: WorkoutKind;
  date: string;
  startAt: Date | null;
  durationMin: number;
  activeKcal: number | null;
  distanceKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  device: string | null;
};
export type ParsedPayload = { samples: ParsedSample[]; sleep: ParsedSleep[]; workouts: ParsedWorkout[]; skipped: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** {qty, units} of een getal; een lijst (per minuut, oudere versies) wordt opgeteld. */
function quantity(v: unknown, fallbackUnits = ""): { qty: number; units: string } | null {
  if (v == null) return null;
  const n = num(v);
  if (n !== null) return { qty: n, units: fallbackUnits };
  if (isObj(v)) {
    const q = num(v.qty);
    return q === null ? null : { qty: q, units: str(v.units) ?? fallbackUnits };
  }
  if (Array.isArray(v)) {
    let total = 0;
    let units = fallbackUnits;
    let any = false;
    for (const x of v) {
      if (!isObj(x)) continue;
      const q = num(x.qty);
      if (q === null) continue;
      total += q;
      units = str(x.units) ?? units;
      any = true;
    }
    return any ? { qty: total, units } : null;
  }
  return null;
}

const kcalOf = (q: { qty: number; units: string } | null) => (q ? Math.round(convert("active_energy", q.qty, q.units) ?? q.qty) : null);

function parseSleep(m: Obj, out: ParsedSleep[]) {
  const data = Array.isArray(m.data) ? m.data.filter(isObj) : [];
  const byDate = new Map<string, ParsedSleep>();
  const units = (str(m.units) ?? "hr").toLowerCase();
  const toMin = (v: unknown) => {
    const n = num(v);
    if (n === null) return null;
    return Math.round(units.startsWith("min") ? n : units === "s" ? n / 60 : n * 60);
  };
  for (const d of data) {
    if ("totalSleep" in d || "asleep" in d || "inBed" in d || "deep" in d) {
      // Per nacht (samengevoegd)
      const end = parseHealthDate(d.sleepEnd) ?? parseHealthDate(d.inBedEnd);
      const start = parseHealthDate(d.sleepStart) ?? parseHealthDate(d.inBedStart);
      const day = end ? nightDate(end) : parseHealthDate(d.date)?.date;
      if (!day) continue;
      const deep = toMin(d.deep);
      const rem = toMin(d.rem);
      const core = toMin(d.core);
      const asleep = toMin(d.asleep);
      const total = toMin(d.totalSleep) ?? ((asleep ?? 0) + (deep ?? 0) + (rem ?? 0) + (core ?? 0) || null);
      if (total === null && toMin(d.inBed) === null) continue;
      const prev = byDate.get(day);
      // Een tweede blok op dezelfde datum (dutje, of de nacht in twee delen) telt op
      byDate.set(day, {
        date: day,
        totalMin: (prev?.totalMin ?? 0) + (total ?? 0),
        deepMin: sumNull(prev?.deepMin, deep),
        remMin: sumNull(prev?.remMin, rem),
        coreMin: sumNull(prev?.coreMin, core),
        awakeMin: sumNull(prev?.awakeMin, toMin(d.awake)),
        inBedMin: sumNull(prev?.inBedMin, toMin(d.inBed)),
        sleepStart: earliest(prev?.sleepStart ?? null, start?.at ?? null),
        sleepEnd: latest(prev?.sleepEnd ?? null, end?.at ?? null),
        source: str(d.source) ?? prev?.source ?? null,
      });
    } else if ("startDate" in d || "endDate" in d) {
      // Per fase (niet samengevoegd): Core, Deep, REM, Awake, In Bed, Asleep
      const end = parseHealthDate(d.endDate);
      const start = parseHealthDate(d.startDate);
      const q = num(d.qty);
      if (!end) continue;
      const min = q !== null ? toMin(q)! : start ? Math.round((end.at.getTime() - start.at.getTime()) / 60000) : 0;
      const day = nightDate(end);
      const cur =
        byDate.get(day) ??
        ({ date: day, totalMin: 0, deepMin: null, remMin: null, coreMin: null, awakeMin: null, inBedMin: null, sleepStart: null, sleepEnd: null, source: str(d.source) } as ParsedSleep);
      const v = (str(d.value) ?? "").toLowerCase();
      if (v.includes("awake") || v.includes("wakker")) cur.awakeMin = (cur.awakeMin ?? 0) + min;
      else if (v.includes("bed")) cur.inBedMin = (cur.inBedMin ?? 0) + min;
      else {
        cur.totalMin += min;
        if (v.includes("deep") || v.includes("diep")) cur.deepMin = (cur.deepMin ?? 0) + min;
        else if (v.includes("rem")) cur.remMin = (cur.remMin ?? 0) + min;
        else if (v.includes("core") || v.includes("kern")) cur.coreMin = (cur.coreMin ?? 0) + min;
        cur.sleepStart = earliest(cur.sleepStart, start?.at ?? null);
        cur.sleepEnd = latest(cur.sleepEnd, end.at);
      }
      byDate.set(day, cur);
    }
  }
  for (const s of byDate.values()) if (s.totalMin > 0 || s.inBedMin) out.push(s);
}

function sumNull(a: number | null | undefined, b: number | null) {
  return a == null && b == null ? null : (a ?? 0) + (b ?? 0);
}
const earliest = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a < b ? a : b);
const latest = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);

function parseWorkout(w: Obj): ParsedWorkout | null {
  const rawName = str(w.name) ?? str(w.workoutActivityType) ?? str(w.type);
  const start = parseHealthDate(w.start ?? w.startDate);
  if (!rawName || !start) return null;
  const end = parseHealthDate(w.end ?? w.endDate);
  let durationMin: number | null = null;
  const dur = quantity(w.duration, "s");
  if (dur) {
    const u = dur.units.toLowerCase();
    durationMin = u.startsWith("min") ? dur.qty : u.startsWith("h") ? dur.qty * 60 : dur.qty / 60;
  }
  if ((durationMin === null || durationMin <= 0) && end) durationMin = (end.at.getTime() - start.at.getTime()) / 60000;
  if (durationMin === null || !Number.isFinite(durationMin) || durationMin <= 0) return null;
  const energy = quantity(w.activeEnergyBurned, "kcal") ?? quantity(w.activeEnergy, "kcal");
  const dist = quantity(w.distance, "km");
  const hr = isObj(w.heartRate) ? w.heartRate : null;
  const avgHr = num(isObj(hr?.avg) ? hr.avg.qty : null) ?? quantity(w.avgHeartRate)?.qty ?? null;
  const maxHr = num(isObj(hr?.max) ? hr.max.qty : null) ?? quantity(w.maxHeartRate)?.qty ?? null;
  const distanceKm = dist ? convert("distance", dist.qty, dist.units) : null;
  return {
    externalId: str(w.id) ?? `${rawName}|${start.at.toISOString()}`,
    name: workoutName(rawName),
    kind: workoutKind(rawName),
    date: start.date,
    startAt: start.at,
    durationMin: Math.round(durationMin),
    activeKcal: kcalOf(energy),
    distanceKm: distanceKm && distanceKm > 0.01 ? Math.round(distanceKm * 100) / 100 : null,
    avgHr: avgHr ? Math.round(avgHr) : null,
    maxHr: maxHr ? Math.round(maxHr) : null,
    device: str(w.source) ?? (isObj(w.metadata) ? str(w.metadata.source) : null),
  };
}

/** De hele zending van Health Auto Export lezen. Onbekende metingen komen in `skipped` (worden genegeerd). */
export function parseHealthExport(body: unknown): ParsedPayload {
  const root = isObj(body) && isObj(body.data) ? body.data : isObj(body) ? body : {};
  const out: ParsedPayload = { samples: [], sleep: [], workouts: [], skipped: [] };
  const skipped = new Set<string>();

  const metrics = Array.isArray(root.metrics) ? root.metrics.filter(isObj) : [];
  for (const m of metrics) {
    const name = (str(m.name) ?? "").toLowerCase().replace(/[\s-]+/g, "_");
    if (name === "sleep_analysis" || name === "sleep") {
      parseSleep(m, out.sleep);
      continue;
    }
    const key = HAE_NAMES[name];
    if (!key) {
      if (name) skipped.add(name);
      continue;
    }
    const units = str(m.units) ?? "";
    const rows: (ParsedSample & { clock: number })[] = [];
    for (const d of Array.isArray(m.data) ? m.data.filter(isObj) : []) {
      const when = parseHealthDate(d.date ?? d.startDate);
      const q = num(d.qty) ?? num(d.Avg) ?? num(d.avg);
      if (!when || q === null) continue;
      const v = convert(key, q, str(d.units) ?? units);
      if (v === null || !Number.isFinite(v)) continue;
      rows.push({ metric: key, date: when.date, at: when.at, qty: v, unit: METRICS[key].unit, source: str(d.source) ?? "", dayLevel: false, clock: when.clock });
    }
    // Eén waarde per dag om middernacht = samengevoegd per dag (vervangt eventuele uurwaarden van die dag)
    const perDate = new Map<string, number>();
    for (const r of rows) perDate.set(r.date, (perDate.get(r.date) ?? 0) + 1);
    for (const { clock, ...r } of rows) out.samples.push({ ...r, dayLevel: perDate.get(r.date) === 1 && METRICS[key].agg === "sum" && clock === 0 });
  }

  const workouts = Array.isArray(root.workouts) ? root.workouts.filter(isObj) : [];
  for (const w of workouts) {
    const p = parseWorkout(w);
    if (p) out.workouts.push(p);
  }
  out.skipped = [...skipped].sort();
  return out;
}

/* ---------------- Weergave ---------------- */

export function fmtMetric(key: MetricKey, v: number | null | undefined): string {
  if (v == null) return "–";
  const d = METRICS[key].decimals;
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
}

export function fmtSleep(min: number | null | undefined): string {
  if (min == null) return "–";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}u${m ? String(m).padStart(2, "0") : ""}`;
}
