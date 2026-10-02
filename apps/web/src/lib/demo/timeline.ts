/**
 * The demo farm's season timeline (client-safe, no DB). Given `now`, it
 * places every planting, record and open task so the farm looks live on that
 * day: records only up to `now`, the crops in the ground that fit the season,
 * and plenty of work coming up. The seeder in `lib/db/demo/seed.ts` writes
 * what this returns.
 */

import {
  DEMO_CROPS,
  DEMO_PERENNIALS,
  DEMO_PRODUCTS,
  type DemoBedKey,
  type DemoCropTemplate,
  type DemoEquipmentKey,
  type DemoHarvestPlan,
  type DemoOpAt,
  type DemoSprayerKey,
  type SeasonDate
} from './catalog';
import {
  addDaysYmd,
  addMonthsYmd,
  daysBetweenYmd,
  demoSeason,
  hashSeed,
  parseYmd,
  prng,
  utcDayMs,
  ymdInYear,
  zonedMs,
  type DemoSeason
} from './time';

export const TASK_HORIZON_DAYS = 70;
/** Done tasks are kept for work closed this recently. */
export const DONE_TASK_LOOKBACK_DAYS = 30;

export type PlantingMode = 'history' | 'current' | 'next';
export type DemoPlantingStatus = 'planned' | 'active' | 'harvested';

export interface DemoPlanting {
  key: string;
  templateKey: string;
  season: number;
  mode: PlantingMode | 'perennial';
  bed: DemoBedKey;
  cropPluginId: string;
  variety: string;
  /** UTC midnight of the in-ground day. */
  plantingDate: number;
  status: DemoPlantingStatus;
  harvestedAt?: number;
  establishment?: 'direct-seed' | 'transplant';
  /** UTC midnight of the indoor sowing day. */
  sownIndoorsAt?: number;
  quantity?: { amount: number; unit: string };
  footprint?: { x_in: number; y_in: number; w_in: number; l_in: number };
  spacingIn?: number;
  plantCount?: number;
  seed?: string;
  windowStartYmd: string;
  windowEndYmd: string;
}

export interface DemoSpray {
  plantingKey: string;
  bed: DemoBedKey;
  at: number;
  product: string;
  kind: 'herbicide' | 'insecticide' | 'fungicide';
  sprayer: DemoSprayerKey;
  target?: string;
  windMph: number;
  tempF: number;
}

export interface DemoHarvest {
  plantingKey: string;
  bed: DemoBedKey;
  cropPluginId: string;
  at: number;
  amount: number;
  unit: string;
  moisturePct?: number;
  lotNumber: string;
}

export interface DemoScout {
  plantingKey: string;
  bed: DemoBedKey;
  at: number;
  pest: string;
  metric: string;
  value: number;
  notes?: string;
}

export interface DemoFertility {
  plantingKey: string;
  bed: DemoBedKey;
  at: number;
  product: string;
  ratePerAcre: number;
  rateUnit: string;
  n: number;
  p: number;
  k: number;
}

export interface DemoJournal {
  plantingKey: string;
  bed: DemoBedKey;
  at: number;
  text: string;
}

export interface DemoSeedStart {
  plantingKey: string;
  sownAt: number;
  cells: number;
  trayLabel: string;
  germinatedAt?: number;
  germinatedCount?: number;
  hardenStartedAt?: number;
  transplantedAt?: number;
}

export type HayStatus = 'mowing' | 'tedding' | 'raking' | 'baling' | 'complete';

export interface DemoHayCutting {
  plantingKey: string;
  season: number;
  number: number;
  mowAt: number;
  tedAt?: number;
  rakeAt?: number;
  baleAt?: number;
  storedAt?: number;
  status: HayStatus;
  bales?: number;
  moisturePct?: number;
}

export type DemoTaskCategory =
  'plant' | 'fertilize' | 'spray' | 'scout' | 'prune' | 'harvest' | 'hay-cutting' | 'other';

export type DemoRelatedTable =
  | 'spray_event'
  | 'insecticide_event'
  | 'fungicide_event'
  | 'harvest_event'
  | 'hay_cutting'
  | 'fertility_application';

export interface DemoTask {
  key: string;
  title: string;
  body?: string;
  category: DemoTaskCategory;
  /** UTC midnight of the due day. */
  due: number;
  plantingKey?: string;
  bed?: DemoBedKey;
  equipment?: DemoEquipmentKey;
  relatedTable?: DemoRelatedTable;
  seedStep?: 'sow' | 'harden' | 'transplant';
  /** Closed at this instant (a done task). */
  doneAt?: number;
}

export interface DemoProduction {
  subject: 'flock' | 'goats';
  kind: 'eggs' | 'milk';
  at: number;
  quantity: number;
  unit: 'eggs' | 'qt';
  use: 'food' | 'sale';
}

export interface DemoIrrigation {
  area: 'garden' | 'tunnel';
  bed?: DemoBedKey;
  at: number;
  durationMin: number;
  inches: number;
  method: 'drip' | 'hand';
  notes?: string;
}

export interface DemoRain {
  area: 'garden';
  at: number;
  inches: number;
}

export type DemoLedgerCategory =
  'produce-sale' | 'animal-product-sale' | 'fuel' | 'equipment-and-repairs' | 'supplies';

export interface DemoLedger {
  kind: 'expense' | 'income';
  at: number;
  amountCents: number;
  category: DemoLedgerCategory;
  description: string;
  enterprise?: string;
  quantity?: number;
  unit?: string;
  plantingKey?: string;
  /** The harvest record this sale is for (same planting and instant). */
  harvestAt?: number;
  subject?: 'flock';
}

export interface DemoCarePlan {
  subject: 'flock' | 'goats' | 'dog';
  kind: 'health-check' | 'hoof-trim' | 'deworm' | 'vaccination' | 'grooming';
  title: string;
  intervalDays: number;
  nextDue: string;
  leadDays: number;
}

export interface DemoTimeline {
  season: DemoSeason;
  plantings: DemoPlanting[];
  sprays: DemoSpray[];
  harvests: DemoHarvest[];
  scouts: DemoScout[];
  fertility: DemoFertility[];
  journal: DemoJournal[];
  seedStarts: DemoSeedStart[];
  hay: DemoHayCutting[];
  tasks: DemoTask[];
  production: DemoProduction[];
  irrigation: DemoIrrigation[];
  rain: DemoRain[];
  ledger: DemoLedger[];
  carePlans: DemoCarePlan[];
  /** Latest calibration of each sprayer, at or before now. */
  calibrations: Array<{ sprayer: DemoSprayerKey; at: number }>;
  soilTests: Array<{ bed: DemoBedKey; at: number }>;
}

const SPRAY_KIND = {
  herbicide: 'herbicide',
  insecticide: 'insecticide',
  fungicide: 'fungicide'
} as const;

const RELATED_FOR_SPRAY: Record<DemoSpray['kind'], DemoRelatedTable> = {
  herbicide: 'spray_event',
  insecticide: 'insecticide_event',
  fungicide: 'fungicide_event'
};

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function between(rand: () => number, [lo, hi]: [number, number], places = 1): number {
  return round(lo + (hi - lo) * rand(), places);
}

function monthOf(ymd: string): number {
  return parseYmd(ymd).month;
}

/** Temperatures a Leesburg spray morning plausibly has, by month. */
const SPRAY_TEMP_F = [34, 38, 48, 58, 66, 74, 79, 77, 70, 58, 47, 38];

function plantCount(
  footprint: DemoCropTemplate['footprint'],
  spacingIn: number | undefined
): number | undefined {
  if (!footprint || !spacingIn) return undefined;
  return Math.max(
    1,
    Math.floor(footprint.w_in / spacingIn) * Math.floor(footprint.l_in / spacingIn)
  );
}

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

const BED_LABEL: Record<DemoBedKey, string> = {
  nfA: 'North Field A',
  nfB: 'North Field B',
  nfC: 'North Field C',
  hay: 'the Hay Meadow',
  g1: 'Bed 1',
  g2: 'Bed 2',
  g3: 'Bed 3',
  g4: 'Bed 4',
  g5: 'Bed 5',
  g6: 'Bed 6',
  g7: 'Bed 7',
  g8: 'Bed 8',
  tE: 'the tunnel east bed',
  tW: 'the tunnel west bed',
  apple: 'the apple row',
  peach: 'the peach row'
};

const LOT_CODE: Record<string, string> = {
  'corn-feed-dent-pioneer': 'CRN',
  'soybean-asgrow-roundup-ready-2-xtend': 'SOY',
  'wheat-soft-red-winter': 'WHT',
  'apple-honeycrisp': 'APL',
  'peach-redhaven': 'PCH'
};

function lotNumber(cropPluginId: string, ymd: string): string {
  const code =
    LOT_CODE[cropPluginId] ??
    cropPluginId
      .replace(/[^a-z]/g, '')
      .slice(0, 3)
      .toUpperCase();
  return `WR-${ymd.slice(2).replace(/-/g, '')}-${code}`;
}

export function buildDemoTimeline(now: number): DemoTimeline {
  const season = demoSeason(now);
  const { today, current: C } = season;
  const horizonEnd = addDaysYmd(today, TASK_HORIZON_DAYS);
  const doneFrom = addDaysYmd(today, -DONE_TASK_LOOKBACK_DAYS);
  const seedBase = hashSeed(today);
  const randFor = (key: string) => prng(seedBase ^ hashSeed(key));

  const out: DemoTimeline = {
    season,
    plantings: [],
    sprays: [],
    harvests: [],
    scouts: [],
    fertility: [],
    journal: [],
    seedStarts: [],
    hay: [],
    tasks: [],
    production: [],
    irrigation: [],
    rain: [],
    ledger: [],
    carePlans: [],
    calibrations: [],
    soilTests: []
  };

  const isPast = (instant: number) => instant <= now;
  const inHorizon = (ymd: string) => ymd > today && ymd <= horizonEnd;
  const taskKeys = new Set<string>();
  const addTask = (task: DemoTask) => {
    if (taskKeys.has(task.key)) return;
    taskKeys.add(task.key);
    out.tasks.push(task);
  };

  const recent = recentSprayTarget(season);

  for (const t of DEMO_CROPS) {
    if (t.history) addCropInstance(t, C - 1, 'history');
    addCropInstance(t, C, 'current');
    if (season.nextSeasonPlanned) addCropInstance(t, C + 1, 'next');
  }
  for (const p of DEMO_PERENNIALS) addPerennial(p);

  if (recent) {
    const planting = out.plantings.find((p) => p.key === recent.plantingKey);
    if (planting) {
      const rand = randFor(`recent-spray`);
      out.sprays.push({
        plantingKey: planting.key,
        bed: planting.bed,
        at: now - 20 * 60 * 60 * 1000,
        product: 'kocide-3000-o',
        kind: 'fungicide',
        sprayer: recent.sprayer,
        target: recent.target,
        windMph: between(rand, [2, 5]),
        tempF: SPRAY_TEMP_F[monthOf(today) - 1] + Math.round(rand() * 6 - 3)
      });
    }
  }

  addRecentScout();
  addAnimals();
  addWater();
  addFarmRoutine();
  addLedger();
  addCalibrations();

  out.soilTests = (['g1', 'nfA', 'tE'] as const).map((bed, i) => ({
    bed,
    at: zonedMs(ymdInYear(C - 1, '11-06'), 10 + i)
  }));

  out.sprays.sort((a, b) => a.at - b.at);
  out.harvests.sort((a, b) => a.at - b.at);
  out.tasks.sort((a, b) => a.due - b.due || a.key.localeCompare(b.key));
  return out;

  // ─── crops ──────────────────────────────────────────────────────────

  function opYmd(seasonYear: number, plantYmd: string, at: DemoOpAt): string {
    return 'days' in at ? addDaysYmd(plantYmd, at.days) : seasonYmd(seasonYear, at);
  }

  function seasonYmd(seasonYear: number, d: SeasonDate): string {
    return ymdInYear(seasonYear + (d.yearOffset ?? 0), d.mmdd);
  }

  function harvestDays(
    plan: DemoHarvestPlan,
    seasonYear: number,
    windowStartYmd: string
  ): string[] {
    if (plan.kind === 'terminate') return [];
    if (plan.kind === 'once') {
      return [
        'afterWindowStart' in plan.at
          ? addDaysYmd(windowStartYmd, plan.at.afterWindowStart)
          : seasonYmd(seasonYear, plan.at)
      ];
    }
    const days: string[] = [];
    const until = plan.until;
    if ('count' in until) {
      for (let i = 0; i < until.count; i++)
        days.push(addDaysYmd(windowStartYmd, i * plan.everyDays));
    } else {
      const end = seasonYmd(seasonYear, until);
      for (let d = windowStartYmd; d <= end; d = addDaysYmd(d, plan.everyDays)) days.push(d);
    }
    return days;
  }

  /** Days a spray keeps the planting closed to picking (PHI and REI). */
  function blockedDays(product: string): number {
    const p = DEMO_PRODUCTS[product];
    if (!p) return 0;
    return Math.max(p.phiDays ?? 0, Math.ceil((p.reiHours ?? 0) / 24));
  }

  function addCropInstance(t: DemoCropTemplate, seasonYear: number, mode: PlantingMode) {
    const plantYmd = seasonYmd(seasonYear, t.plant);
    const bed = typeof t.bed === 'function' ? t.bed(seasonYear) : t.bed;
    const key = `${t.key}@${seasonYear}`;
    const rand = randFor(key);
    const windowStartYmd = addDaysYmd(plantYmd, t.dtm[0]);
    const windowEndYmd = addDaysYmd(plantYmd, t.dtm[1]);
    const label = BED_LABEL[bed];

    const sprayDays: Array<{ ymd: string; product: string }> = [];
    for (const op of t.ops) {
      if (op.kind !== 'spray') continue;
      const ymd = opYmd(seasonYear, plantYmd, op.at);
      if (recent?.plantingKey === key && Math.abs(daysBetweenYmd(ymd, today)) <= 4) continue;
      sprayDays.push({ ymd, product: op.product });
    }
    if (recent?.plantingKey === key) sprayDays.push({ ymd: today, product: 'kocide-3000-o' });

    const pickDays = harvestDays(t.harvest, seasonYear, windowStartYmd).filter(
      (d) =>
        !sprayDays.some((s) => d >= s.ymd && daysBetweenYmd(s.ymd, d) <= blockedDays(s.product))
    );
    const harvestHour = 10;
    const endYmd =
      t.harvest.kind === 'terminate'
        ? seasonYmd(seasonYear, t.harvest.at)
        : pickDays[pickDays.length - 1];
    const endInstant = endYmd ? zonedMs(endYmd, harvestHour) : Infinity;

    const plantInstant = zonedMs(plantYmd, 8);
    const status: DemoPlantingStatus =
      plantYmd > today || !isPast(plantInstant)
        ? 'planned'
        : isPast(endInstant)
          ? 'harvested'
          : 'active';
    if (mode === 'next' && status === 'harvested') return;

    const sowYmd =
      t.establishment === 'transplant' && t.indoorWeeks
        ? addDaysYmd(plantYmd, -7 * t.indoorWeeks)
        : null;

    const planting: DemoPlanting = {
      key,
      templateKey: t.key,
      season: seasonYear,
      mode,
      bed,
      cropPluginId: t.cropPluginId,
      variety: t.variety,
      plantingDate: utcDayMs(plantYmd),
      status,
      harvestedAt: status === 'harvested' ? endInstant : undefined,
      establishment: t.establishment,
      sownIndoorsAt: sowYmd ? utcDayMs(sowYmd) : undefined,
      quantity: t.quantity,
      footprint: t.footprint,
      spacingIn: t.spacingIn,
      plantCount: plantCount(t.footprint, t.spacingIn),
      seed: t.seed,
      windowStartYmd,
      windowEndYmd
    };
    out.plantings.push(planting);

    // Ops: a record once it has happened, a task while it is coming up.
    let opIndex = 0;
    for (const op of t.ops) {
      opIndex++;
      const ymd = opYmd(seasonYear, plantYmd, op.at);
      const opKey = `${key}:op${opIndex}`;
      if (op.kind === 'spray') {
        if (!sprayDays.some((s) => s.ymd === ymd && s.product === op.product)) continue;
        const product = DEMO_PRODUCTS[op.product];
        const kind = SPRAY_KIND[product.kind as keyof typeof SPRAY_KIND];
        const instant = zonedMs(ymd, op.sprayer === 'boom' ? 7 : 8, 30);
        if (isPast(instant)) {
          out.sprays.push({
            plantingKey: key,
            bed,
            at: instant,
            product: op.product,
            kind,
            sprayer: op.sprayer,
            target: op.target,
            windMph: between(rand, [2, 7]),
            tempF: SPRAY_TEMP_F[monthOf(ymd) - 1] + Math.round(rand() * 8 - 4)
          });
        } else if (inHorizon(ymd)) {
          addTask({
            key: opKey,
            title: `Spray ${product.displayName.split(' (')[0]} on ${t.variety}`,
            body: op.target ? `Target: ${op.target}.` : undefined,
            category: 'spray',
            due: utcDayMs(ymd),
            plantingKey: key,
            bed,
            equipment: op.sprayer,
            relatedTable: RELATED_FOR_SPRAY[kind]
          });
        }
      } else if (op.kind === 'fertilize') {
        const product = DEMO_PRODUCTS[op.product];
        const instant = zonedMs(ymd, 9);
        if (isPast(instant)) {
          const lbProduct = op.rateUnit === 'gal' ? op.ratePerAcre * 10.67 : op.ratePerAcre;
          const npk = product.npk ?? { n: 0, p: 0, k: 0 };
          out.fertility.push({
            plantingKey: key,
            bed,
            at: instant,
            product: op.product,
            ratePerAcre: op.ratePerAcre,
            rateUnit: op.rateUnit,
            n: round((lbProduct * npk.n) / 100),
            p: round((lbProduct * npk.p) / 100),
            k: round((lbProduct * npk.k) / 100)
          });
        } else if (inHorizon(ymd)) {
          addTask({
            key: opKey,
            title: `Apply ${product.displayName.split(' (')[0]} to ${label}`,
            category: 'fertilize',
            due: utcDayMs(ymd),
            plantingKey: key,
            bed,
            relatedTable: 'fertility_application'
          });
        }
      } else if (op.kind === 'scout') {
        const instant = zonedMs(ymd, 16, 15);
        if (isPast(instant)) {
          out.scouts.push({
            plantingKey: key,
            bed,
            at: instant,
            pest: op.pest,
            metric: op.metric,
            value: between(rand, op.value),
            notes: op.notes
          });
        } else if (inHorizon(ymd)) {
          addTask({
            key: opKey,
            title: `Scout ${t.variety} for ${op.pest}`,
            category: 'scout',
            due: utcDayMs(ymd),
            plantingKey: key,
            bed
          });
        }
      } else if (op.kind === 'journal') {
        const instant = zonedMs(ymd, 19, 10);
        if (isPast(instant) && status !== 'planned') {
          out.journal.push({ plantingKey: key, bed, at: instant, text: op.text });
        }
      } else {
        const instant = zonedMs(ymd, 9);
        if (isPast(instant)) {
          if (ymd >= doneFrom) {
            addTask({
              key: opKey,
              title: op.title,
              body: op.body,
              category: 'other',
              due: utcDayMs(ymd),
              plantingKey: key,
              bed,
              doneAt: zonedMs(ymd, 15)
            });
          }
        } else if (inHorizon(ymd)) {
          addTask({
            key: opKey,
            title: op.title,
            body: op.body,
            category: 'other',
            due: utcDayMs(ymd),
            plantingKey: key,
            bed
          });
        }
      }
    }

    // Harvests.
    const unitLabel = 'unit' in t.harvest ? t.harvest.unit : '';
    let nextHarvestTasked = false;
    pickDays.forEach((ymd, i) => {
      const instant = zonedMs(ymd, harvestHour, 15 * (i % 3));
      if (isPast(instant)) {
        if (t.harvest.kind === 'terminate') return;
        out.harvests.push({
          plantingKey: key,
          bed,
          cropPluginId: t.cropPluginId,
          at: instant,
          amount: between(rand, t.harvest.qty, unitLabel === 'bu' || unitLabel === 'lb' ? 1 : 0),
          unit: unitLabel,
          moisturePct:
            t.harvest.kind === 'once' && t.harvest.moisturePct
              ? between(rand, t.harvest.moisturePct)
              : undefined,
          lotNumber: lotNumber(t.cropPluginId, ymd)
        });
      } else if (!nextHarvestTasked && inHorizon(ymd) && status !== 'harvested') {
        nextHarvestTasked = true;
        const picking = t.harvest.kind === 'picks';
        addTask({
          key: `${key}:harvest`,
          title: picking ? `Pick ${t.variety}` : `Harvest ${t.variety}`,
          body:
            t.harvest.kind === 'once' && t.harvest.moisturePct
              ? 'Check grain moisture before running the combine.'
              : undefined,
          category: 'harvest',
          due: utcDayMs(ymd),
          plantingKey: key,
          bed,
          relatedTable: 'harvest_event'
        });
      }
    });
    if (t.harvest.kind === 'terminate' && endYmd && !isPast(endInstant) && inHorizon(endYmd)) {
      addTask({
        key: `${key}:terminate`,
        title: `Terminate ${t.variety} in ${label}`,
        category: 'other',
        due: utcDayMs(endYmd),
        plantingKey: key,
        bed
      });
    }

    // Planting work and seed starting.
    if (mode === 'history') return;
    if (sowYmd) {
      const sowInstant = zonedMs(sowYmd, 9);
      const hardenYmd = addDaysYmd(plantYmd, -7);
      const cells = (planting.plantCount ?? 24) <= 36 ? 36 : 72;
      if (isPast(sowInstant)) {
        const germYmd = addDaysYmd(sowYmd, 7);
        const germInstant = zonedMs(germYmd, 18);
        const hardenInstant = zonedMs(hardenYmd, 9);
        out.seedStarts.push({
          plantingKey: key,
          sownAt: sowInstant,
          cells,
          trayLabel: `${t.variety.split(' ')[0]} ${cells}-cell`,
          germinatedAt: isPast(germInstant) ? germInstant : undefined,
          germinatedCount: isPast(germInstant)
            ? Math.max(1, Math.round(cells * between(rand, [0.84, 0.95], 2)))
            : undefined,
          hardenStartedAt: isPast(hardenInstant) ? hardenInstant : undefined,
          transplantedAt: isPast(plantInstant) ? plantInstant : undefined
        });
      }
      const steps: Array<['sow' | 'harden' | 'transplant', string, string]> = [
        ['sow', sowYmd, `Sow ${t.variety} indoors`],
        ['harden', hardenYmd, `Start hardening off ${t.variety}`],
        ['transplant', plantYmd, `Transplant ${t.variety} into ${label}`]
      ];
      for (const [step, ymd, title] of steps) {
        if (!inHorizon(ymd)) continue;
        addTask({
          key: `${key}:seed-${step}`,
          title,
          category: step === 'harden' ? 'other' : 'plant',
          due: utcDayMs(ymd),
          plantingKey: key,
          bed,
          seedStep: step
        });
      }
    } else if (inHorizon(plantYmd)) {
      addTask({
        key: `${key}:plant`,
        title: `Plant ${t.variety} in ${label}`,
        category: 'plant',
        due: utcDayMs(plantYmd),
        plantingKey: key,
        bed,
        equipment: bed.startsWith('nf')
          ? t.key === 'corn' || t.key === 'soy'
            ? 'planter'
            : 'drill'
          : undefined
      });
    }
  }

  function addPerennial(p: (typeof DEMO_PERENNIALS)[number]) {
    const plantYmd = addMonthsYmd(today, -p.ageMonths).slice(0, 8) + '15';
    const key = `${p.key}@perennial`;
    const rand = randFor(key);
    out.plantings.push({
      key,
      templateKey: p.key,
      season: parseYmd(plantYmd).year,
      mode: 'perennial',
      bed: p.bed,
      cropPluginId: p.cropPluginId,
      variety: p.variety,
      plantingDate: utcDayMs(plantYmd),
      status: 'active',
      establishment: 'transplant',
      windowStartYmd: addDaysYmd(plantYmd, p.dtm[0]),
      windowEndYmd: addDaysYmd(plantYmd, p.dtm[1])
    });
    for (const s of [C - 1, C, C + 1]) {
      const sprayDays: Array<{ ymd: string; product: string }> = [];
      if (recent?.plantingKey === key) sprayDays.push({ ymd: today, product: 'kocide-3000-o' });
      p.ops.forEach((op, i) => {
        const ymd = ymdInYear(s, op.mmdd);
        if (recent?.plantingKey === key && Math.abs(daysBetweenYmd(ymd, today)) <= 4) return;
        sprayDays.push({ ymd, product: op.product });
        const instant = zonedMs(ymd, 8, 15);
        const product = DEMO_PRODUCTS[op.product];
        const kind = SPRAY_KIND[product.kind as keyof typeof SPRAY_KIND];
        if (isPast(instant)) {
          out.sprays.push({
            plantingKey: key,
            bed: p.bed,
            at: instant,
            product: op.product,
            kind,
            sprayer: op.sprayer,
            target: op.target,
            windMph: between(rand, [2, 6]),
            tempF: SPRAY_TEMP_F[monthOf(ymd) - 1] + Math.round(rand() * 6 - 3)
          });
        } else if (inHorizon(ymd)) {
          addTask({
            key: `${key}:${s}:op${i}`,
            title: `Spray ${product.displayName.split(' (')[0]} on the ${p.bed} row`,
            body: op.target ? `Target: ${op.target}.` : undefined,
            category: 'spray',
            due: utcDayMs(ymd),
            plantingKey: key,
            bed: p.bed,
            equipment: op.sprayer,
            relatedTable: RELATED_FOR_SPRAY[kind]
          });
        }
      });
      if (p.picks) {
        let tasked = false;
        for (let i = 0; i < p.picks.count; i++) {
          const ymd = addDaysYmd(ymdInYear(s, p.picks.start), i * p.picks.everyDays);
          if (
            sprayDays.some(
              (d) => ymd >= d.ymd && daysBetweenYmd(d.ymd, ymd) <= blockedDays(d.product)
            )
          )
            continue;
          const instant = zonedMs(ymd, 9, 30);
          if (isPast(instant)) {
            out.harvests.push({
              plantingKey: key,
              bed: p.bed,
              cropPluginId: p.cropPluginId,
              at: instant,
              amount: between(rand, p.picks.qty),
              unit: p.picks.unit,
              lotNumber: lotNumber(p.cropPluginId, ymd)
            });
          } else if (!tasked && inHorizon(ymd)) {
            tasked = true;
            addTask({
              key: `${key}:${s}:pick`,
              title: `Pick ${p.variety}`,
              category: 'harvest',
              due: utcDayMs(ymd),
              plantingKey: key,
              bed: p.bed,
              relatedTable: 'harvest_event'
            });
          }
        }
      }
      (p.cuttings ?? []).forEach((mmdd, i) => {
        const mowYmd = ymdInYear(s, mmdd);
        const steps = [
          zonedMs(mowYmd, 10),
          zonedMs(addDaysYmd(mowYmd, 1), 11),
          zonedMs(addDaysYmd(mowYmd, 2), 13),
          zonedMs(addDaysYmd(mowYmd, 3), 15),
          zonedMs(addDaysYmd(mowYmd, 3), 19)
        ];
        if (isPast(steps[0])) {
          const done = steps.map(isPast);
          const status: HayStatus = done[4]
            ? 'complete'
            : done[3]
              ? 'baling'
              : done[2]
                ? 'raking'
                : done[1]
                  ? 'tedding'
                  : 'mowing';
          out.hay.push({
            plantingKey: key,
            season: s,
            number: i + 1,
            mowAt: steps[0],
            tedAt: done[1] ? steps[1] : undefined,
            rakeAt: done[2] ? steps[2] : undefined,
            baleAt: done[3] ? steps[3] : undefined,
            storedAt: done[4] ? steps[4] : undefined,
            status,
            bales: done[3] ? Math.round(between(rand, [430 - i * 60, 500 - i * 60], 0)) : undefined,
            moisturePct: done[3] ? between(rand, [14, 17]) : undefined
          });
        } else if (inHorizon(mowYmd)) {
          addTask({
            key: `${key}:${s}:cut${i + 1}`,
            title: `Cut hay: ${ordinal(i + 1)} cutting`,
            body: 'Needs three dry days. Check the hay forecast before mowing.',
            category: 'hay-cutting',
            due: utcDayMs(mowYmd),
            plantingKey: key,
            bed: p.bed,
            equipment: 'mower',
            relatedTable: 'hay_cutting'
          });
        }
      });
    }
  }

  // ─── the rest of the farm ───────────────────────────────────────────

  function addRecentScout() {
    const order = ['cherokee', 'juliet', 'kale', 'spinach', 'wheat', 'garlic', 'corn', 'soy'];
    const active = order
      .map((k) => out.plantings.find((p) => p.templateKey === k && p.status === 'active'))
      .find((p) => p !== undefined);
    const target = active ?? out.plantings.find((p) => p.templateKey === 'orchardgrass')!;
    const rand = randFor('recent-scout');
    const pest =
      target.templateKey === 'orchardgrass'
        ? { pest: 'true armyworm', metric: 'count-per-sqft', value: [0, 1] as [number, number] }
        : target.bed === 'tW' || target.bed === 'tE'
          ? { pest: 'aphids', metric: 'count-per-leaf', value: [1, 4] as [number, number] }
          : target.bed.startsWith('g')
            ? {
                pest: 'tomato hornworm',
                metric: 'count-per-plant',
                value: [0, 1] as [number, number]
              }
            : {
                pest: 'broadleaf weeds',
                metric: 'count-per-10sqft',
                value: [1, 3] as [number, number]
              };
    out.scouts.push({
      plantingKey: target.key,
      bed: target.bed,
      at: now - 22 * 60 * 60 * 1000,
      pest: pest.pest,
      metric: pest.metric,
      value: between(rand, pest.value),
      notes: 'Weekly walk. Nothing at threshold yet.'
    });
  }

  function addAnimals() {
    const rand = randFor('animals');
    for (let d = 0; d <= 14; d++) {
      const ymd = addDaysYmd(today, -d);
      const month = monthOf(ymd);
      const eggAt = zonedMs(ymd, 17, 30);
      if (isPast(eggAt)) {
        const range: [number, number] =
          month === 12 || month === 1 ? [5, 8] : month <= 3 || month >= 10 ? [8, 11] : [11, 14];
        out.production.push({
          subject: 'flock',
          kind: 'eggs',
          at: eggAt,
          quantity: between(rand, range, 0),
          unit: 'eggs',
          use: d % 3 === 0 ? 'sale' : 'food'
        });
      }
      const milkAt = zonedMs(ymd, 7, 0);
      const dry = month === 12 || month === 1 || month === 2;
      if (!dry && isPast(milkAt)) {
        out.production.push({
          subject: 'goats',
          kind: 'milk',
          at: milkAt,
          quantity: between(rand, [4.5, 6.5]),
          unit: 'qt',
          use: 'food'
        });
      }
    }
    const due = (days: number) => addDaysYmd(today, days);
    out.carePlans = [
      {
        subject: 'flock',
        kind: 'health-check',
        title: 'Flock health check: mites, crops and vents',
        intervalDays: 30,
        nextDue: due(5),
        leadDays: 2
      },
      {
        subject: 'goats',
        kind: 'hoof-trim',
        title: 'Trim goat hooves',
        intervalDays: 56,
        nextDue: due(9),
        leadDays: 3
      },
      {
        subject: 'goats',
        kind: 'deworm',
        title: 'FAMACHA check, deworm only the anemic does',
        intervalDays: 90,
        nextDue: due(24),
        leadDays: 3
      },
      {
        subject: 'goats',
        kind: 'vaccination',
        title: 'CD&T booster',
        intervalDays: 365,
        nextDue: due(41),
        leadDays: 7
      },
      {
        subject: 'dog',
        kind: 'grooming',
        title: 'Bath and nail trim for Biscuit',
        intervalDays: 42,
        nextDue: due(12),
        leadDays: 2
      },
      {
        subject: 'dog',
        kind: 'vaccination',
        title: 'Rabies booster (3-year)',
        intervalDays: 1095,
        nextDue: due(58),
        leadDays: 14
      }
    ];
  }

  function addWater() {
    const rand = randFor('water');
    const month = monthOf(today);
    const gardenSeason = month >= 5 && month <= 9;
    for (let d = 1; d <= 21; d += 3) {
      const ymd = addDaysYmd(today, -d);
      if (gardenSeason) {
        out.irrigation.push({
          area: 'garden',
          at: zonedMs(ymd, 6, 30),
          durationMin: 45,
          inches: between(rand, [0.35, 0.5], 2),
          method: 'drip',
          notes: d === 1 ? 'Ran both drip zones. Tomatoes were wilting by noon.' : undefined
        });
      }
    }
    for (let d = gardenSeason ? 2 : 1; d <= 21; d += 7) {
      out.irrigation.push({
        area: 'tunnel',
        at: zonedMs(addDaysYmd(today, -d), 8, 0),
        durationMin: month <= 2 || month === 12 ? 20 : 35,
        inches: between(rand, [0.25, 0.45], 2),
        method: 'drip'
      });
    }
    for (const d of [3, 8, 13]) {
      out.rain.push({
        area: 'garden',
        at: zonedMs(addDaysYmd(today, -d), 7, 0),
        inches: between(rand, [0.1, 1.2], 2)
      });
    }
  }

  function addCalibrations() {
    const latest = (mmdd: string) => {
      const thisYear = ymdInYear(season.year, mmdd);
      const ymd = zonedMs(thisYear, 10) <= now ? thisYear : ymdInYear(season.year - 1, mmdd);
      return zonedMs(ymd, 10);
    };
    out.calibrations = [
      { sprayer: 'boom', at: latest('03-18') },
      { sprayer: 'backpack', at: latest('03-20') },
      { sprayer: 'atv', at: latest('03-04') }
    ];
  }

  function addFarmRoutine() {
    const month = monthOf(today);
    const fieldSeason = month >= 4 && month <= 10;
    const walk = fieldSeason ? 'Walk the North Field and garden' : 'Walk the tunnel and orchard';
    for (const d of [2, 9, 16]) {
      addTask({
        key: `routine:walk:${d}`,
        title: walk,
        body: 'Note weeds, pests and anything at threshold on /scout.',
        category: 'scout',
        due: utcDayMs(addDaysYmd(today, d))
      });
    }
    for (const d of [4, 11, 18]) {
      addTask({
        key: `routine:fence:${d}`,
        title: 'Check the fence charger and goat waterer',
        category: 'other',
        due: utcDayMs(addDaysYmd(today, d))
      });
    }
    addTask({
      key: 'routine:overdue',
      title: 'Replace the leaking hose bib at the barn',
      body: 'Washer kit is on the shelf by the feed bins.',
      category: 'other',
      due: utcDayMs(addDaysYmd(today, -2))
    });
    addTask({
      key: 'routine:today',
      title: 'Move the goats to the east paddock',
      body: 'Rotate before the west side is grazed below 4 in.',
      category: 'other',
      due: utcDayMs(today)
    });
    addTask({
      key: 'routine:done',
      title: 'Restock the first-aid kit in the barn',
      category: 'other',
      due: utcDayMs(addDaysYmd(today, -3)),
      doneAt: Math.min(now - 60 * 60 * 1000, zonedMs(addDaysYmd(today, -3), 16))
    });

    const pools: Record<'winter' | 'spring' | 'summer' | 'fall', RoutineItem[]> = {
      winter: [
        { title: 'Grease the tractor and check fluids', equipment: 'tractor' },
        { title: 'Sharpen the disc mower knives', equipment: 'mower' },
        { title: 'Clean and sanitize the seed-starting trays' },
        { title: 'Check stored squash and garlic for soft spots' },
        { title: 'Prune the Honeycrisp trees', category: 'prune', bed: 'apple' },
        { title: 'Inventory spray products and note lot numbers' },
        { title: 'Replace the backpack sprayer seals', equipment: 'backpack' },
        { title: 'Patch the pasture fence where the deer came through' }
      ],
      spring: [
        { title: 'Roll up the tunnel sides on warm afternoons', bed: 'tE' },
        { title: 'Lay drip tape in the kitchen garden', bed: 'g1' },
        { title: 'Flush the boom sprayer and check every nozzle', equipment: 'boom' },
        { title: 'Turn the compost pile' },
        { title: 'Grease the planter chains', equipment: 'planter' },
        { title: 'Set up the tomato trellis in Bed 1', bed: 'g1' },
        { title: 'Mow the orchard aisles', bed: 'apple' }
      ],
      summer: [
        { title: 'Check the drip lines for leaks', bed: 'g2' },
        { title: 'Pull suckers on the tunnel tomatoes', category: 'prune', bed: 'tE' },
        { title: 'Mow the field edges and fence rows', equipment: 'tractor' },
        { title: 'Check the baler knotters and twine', equipment: 'baler' },
        { title: 'Turn the compost pile' },
        { title: 'Top up straw mulch in the garden paths', bed: 'g5' }
      ],
      fall: [
        { title: 'Pull spent tomato vines and bag the leaves', bed: 'g1' },
        { title: 'Clean out the coop and add fresh bedding' },
        { title: 'Blow out the drip lines before the first freeze', bed: 'g2' },
        { title: 'Grease the tractor and check fluids', equipment: 'tractor' },
        { title: 'Drain and coil the garden hoses' },
        { title: 'Pick up dropped apples under the trees', bed: 'apple' }
      ]
    };
    const poolFor = (ymd: string) => {
      const m = monthOf(ymd);
      return m === 12 || m <= 2
        ? pools.winter
        : m <= 5
          ? pools.spring
          : m <= 8
            ? pools.summer
            : pools.fall;
    };
    const used = new Map<RoutineItem[], number>();
    for (const d of [1, 3, 5, 8, 10, 13, 17, 22, 28, 35, 43, 52, 61]) {
      const ymd = addDaysYmd(today, d);
      const pool = poolFor(ymd);
      const i = used.get(pool) ?? 0;
      if (i >= pool.length) continue;
      used.set(pool, i + 1);
      const item = pool[i];
      addTask({
        key: `routine:pool:${d}`,
        title: item.title,
        category: item.category ?? 'other',
        due: utcDayMs(ymd),
        equipment: item.equipment,
        bed: item.bed
      });
    }

    const oneOffs: Array<{
      mmdd: string;
      title: string;
      body?: string;
      equipment?: DemoEquipmentKey;
      category?: DemoTaskCategory;
    }> = [
      {
        mmdd: '01-20',
        title: 'Place the seed order for next season',
        body: 'Check what is left on /inventory first.'
      },
      {
        mmdd: '03-25',
        title: 'Calibrate the boom sprayer (1/128-acre method)',
        equipment: 'boom'
      },
      { mmdd: '11-03', title: 'Pull soil samples from the garden and North Field' },
      { mmdd: '11-10', title: 'Winterize the boom sprayer', equipment: 'boom' },
      {
        mmdd: '12-01',
        title: 'Close out the season',
        body: 'Run the season close-out from /records once the last harvest is in.'
      }
    ];
    for (const year of [season.year, season.year + 1]) {
      for (const o of oneOffs) {
        const ymd = ymdInYear(year, o.mmdd);
        if (!inHorizon(ymd)) continue;
        addTask({
          key: `oneoff:${year}:${o.mmdd}`,
          title: o.title,
          body: o.body,
          category: o.category ?? 'other',
          due: utcDayMs(ymd),
          equipment: o.equipment
        });
      }
    }
  }

  function addLedger() {
    const rand = randFor('ledger');
    const push = (e: DemoLedger) => {
      if (isPast(e.at)) out.ledger.push(e);
    };
    // Saturday market from June through October.
    for (let d = ymdInYear(C, '06-01'); d <= ymdInYear(C, '10-31'); d = addDaysYmd(d, 1)) {
      if (new Date(utcDayMs(d)).getUTCDay() !== 6) continue;
      push({
        kind: 'income',
        at: zonedMs(d, 13, 30),
        amountCents: Math.round(between(rand, [85, 170], 0)) * 100,
        category: 'produce-sale',
        description: 'Leesburg farmers market: tomatoes, peppers, greens',
        enterprise: 'Market garden'
      });
    }
    // Eggs at the farm stand, the last eight Saturdays.
    for (let d = addDaysYmd(today, -56); d <= today; d = addDaysYmd(d, 1)) {
      if (new Date(utcDayMs(d)).getUTCDay() !== 6) continue;
      const dozens = Math.round(between(rand, [5, 8], 0));
      push({
        kind: 'income',
        at: zonedMs(d, 12, 0),
        amountCents: dozens * 600,
        category: 'animal-product-sale',
        description: `${dozens} dozen eggs, farm stand`,
        enterprise: 'Laying flock',
        quantity: dozens,
        unit: 'dozen',
        subject: 'flock'
      });
    }
    // Grain off the combine, sold to the elevator.
    const price: Record<string, number> = {
      'corn-feed-dent-pioneer': 455,
      'soybean-asgrow-roundup-ready-2-xtend': 1040,
      'wheat-soft-red-winter': 580
    };
    out.harvests.forEach((h) => {
      const cents = price[h.cropPluginId];
      if (!cents) return;
      const at = h.at + 18 * 86_400_000;
      push({
        kind: 'income',
        at,
        amountCents: Math.round(h.amount * cents),
        category: 'produce-sale',
        description: `${h.amount} bu ${h.cropPluginId.split('-')[0]} to the Purcellville elevator`,
        enterprise: 'Grain',
        quantity: h.amount,
        unit: 'bu',
        plantingKey: h.plantingKey,
        harvestAt: h.at
      });
    });
    for (const cut of out.hay) {
      if (cut.season !== C || !cut.storedAt || !cut.bales) continue;
      const sold = Math.min(cut.bales, 150);
      push({
        kind: 'income',
        at: cut.storedAt + 9 * 86_400_000,
        amountCents: sold * 650,
        category: 'produce-sale',
        description: `${sold} small squares, ${ordinal(cut.number)} cutting`,
        enterprise: 'Hay',
        quantity: sold,
        unit: 'bales'
      });
    }
    const costs: Array<[string, number, DemoLedgerCategory, string]> = [
      ['03-01', 18_600, 'supplies', 'Drip tape, fittings and row cover'],
      ['04-12', 31_200, 'fuel', 'Off-road diesel, 100 gal'],
      ['06-03', 41_500, 'equipment-and-repairs', 'Baler knotter rebuild'],
      ['07-14', 33_800, 'fuel', 'Off-road diesel, 100 gal'],
      ['10-06', 29_900, 'fuel', 'Off-road diesel, 90 gal']
    ];
    for (const [mmdd, cents, category, description] of costs) {
      push({
        kind: 'expense',
        at: zonedMs(ymdInYear(C, mmdd), 11),
        amountCents: cents,
        category,
        description
      });
    }
  }
}

interface RoutineItem {
  title: string;
  category?: DemoTaskCategory;
  equipment?: DemoEquipmentKey;
  bed?: DemoBedKey;
}

/** Where the spray from yesterday goes, so a re-entry countdown is running:
 *  the tomatoes while they are fruiting, the peach row otherwise. */
function recentSprayTarget(season: DemoSeason): {
  plantingKey: string;
  sprayer: DemoSprayerKey;
  target: string;
} {
  const plant = ymdInYear(season.current, '05-10');
  const from = addDaysYmd(plant, 30);
  const to = ymdInYear(season.current, '10-04');
  if (season.today >= from && season.today <= to) {
    return {
      plantingKey: `cherokee@${season.current}`,
      sprayer: 'backpack',
      target: 'early blight'
    };
  }
  return { plantingKey: 'peach@perennial', sprayer: 'atv', target: 'bacterial spot' };
}
