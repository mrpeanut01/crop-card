/**
 * 33B (B-50): the animal treatment log. One row per dose of a
 * hold-bearing kind, as the health page shows it; the same table feeds
 * `treatments.csv`, `treatments.pdf` and the certifier pack. Pure: the
 * server module resolves names and runs the withdrawal kernel.
 */

import { FOODS, type Food, type FoodHold } from '$lib/safety/animalWithdrawal';
import { csvDocument, type CsvValue } from './packCsv';

export type TreatmentLogState =
  'live' | 'locked' | 'voided' | 'deleted-still-given' | 'owner-corrected';

export const TREATMENT_LOG_STATE_LABEL: Readonly<Record<TreatmentLogState, string>> = {
  live: 'Open for changes',
  locked: 'Locked',
  voided: 'Voided, never given',
  'deleted-still-given': 'Deleted, still counted as given',
  'owner-corrected': 'Owner-corrected'
};

export interface TreatmentLogWithdrawal {
  food: Food;
  clearOn: string | null;
  source: string;
}

export interface TreatmentLogRow {
  date: string;
  courseEnd: string | null;
  subject: string;
  species: string;
  product: string;
  approvalNumber: string | null;
  lot: string | null;
  dose: string | null;
  route: string | null;
  givenBy: string | null;
  vet: string | null;
  labelUse: string | null;
  withdrawal: TreatmentLogWithdrawal[];
  state: TreatmentLogState;
  enteredLate: string | null;
  organicOutcome: string | null;
}

export const LABEL_USE_TEXT: Readonly<Record<string, string>> = {
  label: 'As the label says',
  'extra-label-vet': 'Vet directed',
  unknown: 'Not sure'
};

export const ROUTE_TEXT: Readonly<Record<string, string>> = {
  oral: 'By mouth',
  'drinking-water': 'In the water',
  feed: 'In the feed',
  'injection-im': 'Shot in the muscle',
  'injection-sc': 'Shot under the skin',
  'injection-iv': 'Shot in a vein',
  intranasal: 'In the nose',
  ocular: 'In the eye',
  topical: 'On the skin',
  'pour-on': 'Pour-on',
  intramammary: 'In the udder',
  other: 'Other'
};

/** Where a food's withdrawal date comes from, in plain words. */
export function withdrawalCell(
  food: Food,
  hold: FoodHold,
  fmtDate: (ms: number) => string,
  hasVetEntry: boolean
): TreatmentLogWithdrawal {
  switch (hold.status) {
    case 'none':
      return { food, clearOn: null, source: 'No withdrawal' };
    case 'until':
      return {
        food,
        clearOn: fmtDate(hold.clearsAtMs),
        source:
          hold.source === 'label'
            ? 'Product label in the library'
            : hold.source === 'entry'
              ? hasVetEntry
                ? 'Vet or owner entry'
                : 'Owner entry'
              : 'Saved with the record'
      };
    case 'unknown':
      return { food, clearOn: null, source: 'Withdrawal not known' };
    case 'prohibited':
      return {
        food,
        clearOn: null,
        source: `Never for food (${hold.cfr.join(', ')})`
      };
  }
}

export interface TreatmentLogInput {
  administeredAt: number;
  courseEndAt: number | null;
  subject: string;
  species: string;
  product: string;
  approvalNumber: string | null;
  lot: string | null;
  dose: number | null;
  doseUnit: string | null;
  route: string | null;
  givenBy: string | null;
  vet: string | null;
  labelUse: string | null;
  /** Foods this subject gives, in display order. */
  foods: readonly Food[];
  /** Null for a void: no hold. */
  holds: Record<Food, FoodHold> | null;
  hasVetEntry: boolean;
  state: TreatmentLogState;
  enteredLate: string | null;
  organicOutcome: string | null;
}

function doseText(dose: number | null, unit: string | null): string | null {
  if (dose === null || !Number.isFinite(dose)) return null;
  return unit?.trim() ? `${dose} ${unit.trim()}` : String(dose);
}

function blankToNull(s: string | null | undefined): string | null {
  return s && s.trim() ? s.trim() : null;
}

export function toTreatmentLogRow(
  input: TreatmentLogInput,
  fmt: { date: (ms: number) => string; clearDate: (ms: number) => string }
): TreatmentLogRow {
  const withdrawal: TreatmentLogWithdrawal[] = input.holds
    ? FOODS.filter((f) => input.foods.includes(f)).map((f) =>
        withdrawalCell(f, input.holds![f], fmt.clearDate, input.hasVetEntry)
      )
    : [];
  return {
    date: fmt.date(input.administeredAt),
    courseEnd: input.courseEndAt === null ? null : fmt.date(input.courseEndAt),
    subject: input.subject,
    species: input.species,
    product: input.product,
    approvalNumber: blankToNull(input.approvalNumber),
    lot: blankToNull(input.lot),
    dose: doseText(input.dose, input.doseUnit),
    route: input.route ? (ROUTE_TEXT[input.route] ?? input.route) : null,
    givenBy: blankToNull(input.givenBy),
    vet: blankToNull(input.vet),
    labelUse: input.labelUse ? (LABEL_USE_TEXT[input.labelUse] ?? input.labelUse) : null,
    withdrawal,
    state: input.state,
    enteredLate: input.enteredLate,
    organicOutcome: input.organicOutcome
  };
}

export const TREATMENT_LOG_HEADER = [
  'Date given',
  'Course end',
  'Animal or group',
  'Species',
  'Product',
  'Approval number',
  'Lot',
  'Dose',
  'Route',
  'Given by',
  'Vet',
  'Label use',
  ...FOODS.flatMap((f) => [`${capital(f)} withdrawal ends`, `${capital(f)} withdrawal source`]),
  'Record state',
  'Saved late',
  'Organic review'
] as const;

function capital(s: string): string {
  return `${s[0].toUpperCase()}${s.slice(1)}`;
}

export function treatmentLogCells(r: TreatmentLogRow): CsvValue[] {
  const byFood = new Map(r.withdrawal.map((w) => [w.food, w]));
  return [
    r.date,
    r.courseEnd,
    r.subject,
    r.species,
    r.product,
    r.approvalNumber,
    r.lot,
    r.dose,
    r.route,
    r.givenBy,
    r.vet,
    r.labelUse,
    ...FOODS.flatMap((f) => {
      const w = byFood.get(f);
      return w ? [w.clearOn, w.source] : [null, null];
    }),
    TREATMENT_LOG_STATE_LABEL[r.state],
    r.enteredLate,
    r.organicOutcome
  ];
}

/** B-44: the standalone log has no preamble (one header row, one row per
 *  dose); the pack's copy carries it. */
export function treatmentLogCsv(rows: readonly TreatmentLogRow[], opts: { preamble: boolean }) {
  return csvDocument(TREATMENT_LOG_HEADER, rows.map(treatmentLogCells), opts);
}

/** One line per food for the PDF's withdrawal cell. */
export function withdrawalText(r: TreatmentLogRow): string {
  if (r.withdrawal.length === 0) return '';
  return r.withdrawal
    .map((w) =>
      w.clearOn
        ? `${capital(w.food)}: ends ${w.clearOn} (${w.source})`
        : `${capital(w.food)}: ${w.source}`
    )
    .join('\n');
}
