/**
 * 33B (plan item 8, B-51 to B-53): the animal section of the year summary.
 * Pure: head counts at the start and end of the year, arrivals and
 * departures by status, treatments by product, production totals by food
 * and use, and the food or sale declarations a hold covered. Everything is
 * "from records on file"; a count the records cannot rebuild is null and
 * shows as "Count not known". It holds no money.
 */

export type HoldBasisText = 'known' | 'unknown' | 'prohibited';

export const ANIMAL_MOVEMENT_LABEL: Readonly<Record<string, string>> = {
  arrived: 'Arrived',
  sold: 'Sold',
  'sold-for-meat': 'Sold for meat',
  slaughtered: 'Slaughtered',
  died: 'Died',
  culled: 'Culled',
  rehomed: 'Rehomed'
};

export const COUNT_NOT_KNOWN = 'Count not known';

/** As the animal pages word a covered log ("Inside a hold"). */
export const COVERED_BASIS_TEXT: Readonly<Record<HoldBasisText, string>> = {
  known: 'Inside a hold',
  unknown: 'Inside a hold: withdrawal or grazing time not known',
  prohibited: 'Inside a hold: never for food'
};

export interface NamedAnimalInput {
  id: string;
  speciesId: string;
  /** `acquired_date`, else `birth_date`, else `created_at`. */
  arrivalMs: number;
  /** The first status change that is not `active`. */
  departure: { status: string; atMs: number } | null;
}

export interface GroupInput {
  id: string;
  speciesId: string;
  createdAtMs: number;
  /** Unnamed head now; null when the row has none (cannot be rebuilt). */
  headCountNow: number | null;
  events: GroupCountEvent[];
  /** Set when a partial move split this group off another one. Its
   *  `createdAtMs` is then the split's moment. */
  splitFrom?: string | null;
}

export interface GroupCountEvent {
  status: string;
  atMs: number;
  headCountDelta: number | null;
  /** A change whose size the records cannot rebuild. */
  unknown?: boolean;
}

/** A synthetic event: unnamed head that left in a split. */
const SPLIT_OUT = 'split-out';

export interface DoseInput {
  product: string;
  subject: string;
}

export interface ProductionInput {
  food: 'eggs' | 'milk';
  use: string;
  useLabel: string;
  unit: string;
  quantity: number;
}

export interface CoveredInput {
  atMs: number;
  subject: string;
  what: 'eggs' | 'milk' | 'meat';
  /** English display label, for the PDF and exports. */
  use: string;
  /** Production use code for eggs and milk, status code for meat. */
  useCode: string;
  basis: HoldBasisText;
}

export interface SpeciesHeadCount {
  speciesId: string;
  atStart: number | null;
  atEnd: number | null;
}

export interface AnimalMovementLine {
  speciesId: string;
  kind: string;
  label: string;
  /** Null when a group change carried no head count. */
  head: number | null;
}

export interface TreatmentProductLine {
  product: string;
  doses: number;
  subjects: string[];
}

export interface ProductionTotalLine {
  food: 'eggs' | 'milk';
  use: string;
  useLabel: string;
  unit: string;
  quantity: number;
  logs: number;
}

export interface CoveredDeclarationLine {
  atMs: number;
  subject: string;
  what: 'eggs' | 'milk' | 'meat';
  use: string;
  useCode: string;
  basis: HoldBasisText;
  basisText: string;
}

export interface YearAnimalSection {
  /** Species id → display name, for every species that appears. */
  speciesNames: Record<string, string>;
  headCounts: SpeciesHeadCount[];
  movements: AnimalMovementLine[];
  treatments: TreatmentProductLine[];
  production: ProductionTotalLine[];
  covered: CoveredDeclarationLine[];
}

export interface ComputeAnimalSectionInput {
  yearStartMs: number;
  /** Inclusive last moment of the year. */
  yearEndMs: number;
  speciesName: (speciesId: string) => string;
  animals: readonly NamedAnimalInput[];
  groups: readonly GroupInput[];
  doses: readonly DoseInput[];
  production: readonly ProductionInput[];
  covered: readonly CoveredInput[];
}

function presentNamed(a: NamedAnimalInput, atMs: number): boolean {
  return a.arrivalMs <= atMs && (a.departure === null || a.departure.atMs > atMs);
}

/** B-51: unnamed head in a group at a moment, walked back from the count
 *  now through later status changes' `head_count_delta`. */
export function groupHeadAt(g: GroupInput, atMs: number): number | null {
  if (g.createdAtMs > atMs) return 0;
  if (g.headCountNow === null) return null;
  let n = g.headCountNow;
  for (const e of g.events) {
    if (e.atMs <= atMs) continue;
    if (e.unknown) return null;
    if (e.headCountDelta !== null) n -= e.headCountDelta;
  }
  return n < 0 ? null : n;
}

/** A split moves unnamed head from one group to a new one without a
 *  status change, so the source group gets a synthetic "split-out" event
 *  for the head the new group started with. Newest groups first, so a
 *  group's own later splits are in place before its starting count is
 *  read. */
export function withSplits(groups: readonly GroupInput[]): GroupInput[] {
  const byId = new Map(groups.map((g) => [g.id, { ...g, events: [...g.events] }]));
  const children = [...byId.values()]
    .filter((g) => g.splitFrom && byId.has(g.splitFrom))
    .sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id));
  for (const child of children) {
    const parent = byId.get(child.splitFrom!)!;
    const k = groupHeadAt(child, child.createdAtMs);
    parent.events.push({
      status: SPLIT_OUT,
      atMs: child.createdAtMs,
      headCountDelta: k === null ? null : -k,
      unknown: k === null
    });
  }
  return groups.map((g) => byId.get(g.id)!);
}

/** B-53: the section shows only when an animal or group touches the year. */
export function touchesYear(
  input: Pick<ComputeAnimalSectionInput, 'animals' | 'groups' | 'yearStartMs' | 'yearEndMs'>
): boolean {
  return (
    input.animals.some(
      (a) =>
        a.arrivalMs <= input.yearEndMs &&
        (a.departure === null || a.departure.atMs >= input.yearStartMs)
    ) || input.groups.some((g) => g.createdAtMs <= input.yearEndMs)
  );
}

function addCount(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

export function computeYearAnimalSection(
  input: ComputeAnimalSectionInput
): YearAnimalSection | null {
  if (!touchesYear(input)) return null;
  const { yearStartMs: start, yearEndMs: end } = input;
  const groups = withSplits(input.groups);
  const knownIds = new Set(groups.map((g) => g.id));
  const inYear = (ms: number) => ms >= start && ms <= end;
  const species = new Set<string>();

  const counts = new Map<string, { atStart: number | null; atEnd: number | null }>();
  const bump = (speciesId: string, atStart: number | null, atEnd: number | null) => {
    species.add(speciesId);
    const c = counts.get(speciesId) ?? { atStart: 0, atEnd: 0 };
    counts.set(speciesId, {
      atStart: addCount(c.atStart, atStart),
      atEnd: addCount(c.atEnd, atEnd)
    });
  };
  const beforeStart = start - 1;
  for (const a of input.animals) {
    const s = presentNamed(a, beforeStart) ? 1 : 0;
    const e = presentNamed(a, end) ? 1 : 0;
    if (s || e || (a.arrivalMs <= end && (a.departure?.atMs ?? Infinity) >= start)) {
      bump(a.speciesId, s, e);
    }
  }
  for (const g of groups) {
    if (g.createdAtMs > end) continue;
    bump(g.speciesId, groupHeadAt(g, beforeStart), groupHeadAt(g, end));
  }

  const moves = new Map<string, AnimalMovementLine>();
  const move = (speciesId: string, kind: string, head: number | null) => {
    species.add(speciesId);
    const key = `${speciesId}\u0000${kind}`;
    const m = moves.get(key) ?? {
      speciesId,
      kind,
      label: ANIMAL_MOVEMENT_LABEL[kind] ?? kind,
      head: 0
    };
    m.head = addCount(m.head, head);
    moves.set(key, m);
  };
  for (const a of input.animals) {
    if (inYear(a.arrivalMs)) move(a.speciesId, 'arrived', 1);
    if (a.departure && inYear(a.departure.atMs)) move(a.speciesId, a.departure.status, 1);
  }
  for (const g of groups) {
    const split = !!g.splitFrom && knownIds.has(g.splitFrom);
    if (inYear(g.createdAtMs) && !split) {
      const initial = groupHeadAt(g, g.createdAtMs);
      if (initial !== 0) move(g.speciesId, 'arrived', initial);
    }
    for (const e of g.events) {
      if (!inYear(e.atMs) || e.status === SPLIT_OUT) continue;
      if (e.status === 'active') {
        if (e.headCountDelta !== null && e.headCountDelta > 0) {
          move(g.speciesId, 'arrived', e.headCountDelta);
        }
        continue;
      }
      move(g.speciesId, e.status, e.headCountDelta === null ? null : Math.abs(e.headCountDelta));
    }
  }

  const byProduct = new Map<string, { doses: number; subjects: Set<string> }>();
  for (const d of input.doses) {
    const p = byProduct.get(d.product) ?? { doses: 0, subjects: new Set<string>() };
    p.doses += 1;
    p.subjects.add(d.subject);
    byProduct.set(d.product, p);
  }

  const prod = new Map<string, ProductionTotalLine>();
  for (const p of input.production) {
    const key = `${p.food}\u0000${p.use}\u0000${p.unit}`;
    const line = prod.get(key) ?? {
      food: p.food,
      use: p.use,
      useLabel: p.useLabel,
      unit: p.unit,
      quantity: 0,
      logs: 0
    };
    line.quantity = Math.round((line.quantity + p.quantity) * 100) / 100;
    line.logs += 1;
    prod.set(key, line);
  }

  const speciesNames: Record<string, string> = {};
  for (const id of species) speciesNames[id] = input.speciesName(id);
  const bySpecies = (a: { speciesId: string }, b: { speciesId: string }) =>
    speciesNames[a.speciesId].localeCompare(speciesNames[b.speciesId]);
  const moveOrder = Object.keys(ANIMAL_MOVEMENT_LABEL);

  return {
    speciesNames,
    headCounts: [...counts.entries()]
      .map(([speciesId, c]) => ({ speciesId, ...c }))
      .sort(bySpecies),
    movements: [...moves.values()].sort(
      (a, b) => bySpecies(a, b) || moveOrder.indexOf(a.kind) - moveOrder.indexOf(b.kind)
    ),
    treatments: [...byProduct.entries()]
      .map(([product, p]) => ({
        product,
        doses: p.doses,
        subjects: [...p.subjects].sort((a, b) => a.localeCompare(b))
      }))
      .sort((a, b) => b.doses - a.doses || a.product.localeCompare(b.product)),
    production: [...prod.values()].sort(
      (a, b) =>
        a.food.localeCompare(b.food) || a.use.localeCompare(b.use) || a.unit.localeCompare(b.unit)
    ),
    covered: input.covered
      .filter((c) => inYear(c.atMs))
      .map((c) => ({ ...c, basisText: COVERED_BASIS_TEXT[c.basis] }))
      .sort((a, b) => a.atMs - b.atMs || a.subject.localeCompare(b.subject))
  };
}

/** A head count cell. */
export function headCountText(n: number | null): string {
  return n === null ? COUNT_NOT_KNOWN : String(n);
}
