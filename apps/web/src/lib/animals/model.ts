/** Client-safe vocabulary for animals and groups. Kept free of server and DB
 *  imports so pages, the OpenAPI generator and the repos share one list.
 *  `apiSchemas.test.ts` pins these against the drizzle enums in `schema.ts`. */

export const ANIMAL_SUBJECT_TYPES = ['animal', 'group'] as const;
export type AnimalSubjectType = (typeof ANIMAL_SUBJECT_TYPES)[number];

export const ANIMAL_PURPOSES = ['production', 'pet', 'mixed'] as const;
export type AnimalPurpose = (typeof ANIMAL_PURPOSES)[number];

export const ANIMAL_SEXES = [
  'female',
  'male',
  'neutered-male',
  'spayed-female',
  'unknown'
] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];

/** Every value `animals.status` can hold. */
export const ANIMAL_STATUSES = [
  'active',
  'sold',
  'died',
  'culled',
  'rehomed',
  'slaughtered',
  'archived'
] as const;
export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];

/** Outcomes a 32B status event may record. The animal is no longer here and
 *  its page is read-only except notes. */
export const OUTCOME_STATUSES = ['sold', 'died', 'culled', 'rehomed'] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

/** Meat declared as food. The status endpoint runs the 32C withdrawal and
 *  grazing exposure gate before recording either (C-17). */
export const MEAT_STATUSES = ['sold-for-meat', 'slaughtered'] as const;
export type MeatStatus = (typeof MEAT_STATUSES)[number];

/** Statuses the status endpoint accepts. `active` is a correction (an
 *  animal marked died that is alive) or, on a group, an addition. */
export const STATUS_EVENT_STATUSES = ['active', ...OUTCOME_STATUSES, ...MEAT_STATUSES] as const;
export type StatusEventStatus = (typeof STATUS_EVENT_STATUSES)[number];

/** Outcomes that may say the meat was used as food, which runs the gate. */
export const MEAT_USED_STATUSES = ['sold', 'died', 'culled'] as const;

/** An animal that is no longer here, whichever way it left. */
export function isOutcomeStatus(status: string): status is OutcomeStatus | MeatStatus {
  return (
    (OUTCOME_STATUSES as readonly string[]).includes(status) ||
    (MEAT_STATUSES as readonly string[]).includes(status)
  );
}

/** The value `animals.status` takes after a status event. */
export function animalStatusAfter(status: Exclude<StatusEventStatus, 'active'>): AnimalStatus {
  return status === 'sold-for-meat' ? 'sold' : status;
}

/** Area kinds that can never house animals. Every other kind can, including
 *  a residence (the house dog) and crop-bearing Areas (sheep on stubble). */
export const NON_HOUSING_AREA_KINDS = ['natural_area', 'water', 'boundary'] as const;

export function isHousingAreaKind(kind: string): boolean {
  return !(NON_HOUSING_AREA_KINDS as readonly string[]).includes(kind);
}

/** Moves may be dated a little ahead of the server clock (phone clock
 *  drift), never further. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const MAX_ANIMAL_NAME = 80;
export const MAX_ANIMAL_TAG = 40;
export const MAX_NOTES = 2000;
export const MAX_REASON = 500;
export const MAX_HEAD_COUNT = 100_000;
