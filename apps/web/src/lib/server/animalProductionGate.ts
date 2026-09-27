import { json } from '@sveltejs/kit';
import type { AnimalSubjectType } from '$lib/animals/model';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import { getAnimal } from '$lib/db/animals';
import { GATED_USES, type ProductionUse } from '$lib/safety/animalWithdrawal';
import type { SessionRole } from '$lib/server/session';
import { checkFoodUse, type FoodCheck, type FoodStop } from './animalFoodGate';
import { foodOf, type RecordWarning } from './animalRecords';

/** The food gate for one production log: the withdrawal rule and the
 *  grazing exposure rule together. Weight is never gated. */
export async function gateProduction(input: {
  subjectType: AnimalSubjectType;
  subjectId: string;
  kind: string;
  use: ProductionUse;
  atMs: number;
  role: SessionRole;
  timeZone: string;
}): Promise<FoodCheck | null> {
  const food = foodOf(input.kind);
  if (!food) return null;
  return checkFoodUse({ ...input, food });
}

/** Milk from an animal recorded as male is never food or for sale: the
 *  grazing holds read a male as never in milk (C-10). Discard still saves. */
export function milkFromMaleRefusal(input: {
  subjectType: AnimalSubjectType;
  subjectId: string;
  kind: string;
  use: ProductionUse;
}): Response | null {
  if (input.kind !== 'milk' || input.subjectType !== 'animal') return null;
  if (!GATED_USES.includes(input.use)) return null;
  const sex = getAnimal(input.subjectId)?.sex;
  if (sex !== 'male' && sex !== 'neutered-male') return null;
  return json(
    {
      error:
        'This animal is recorded as male, so its milk cannot be saved as food or for sale. Fix its sex on its page, or save the milk as discarded.',
      code: 'MILK_FROM_MALE',
      resubmitAs: 'discard',
      overridable: false
    },
    { status: 422 }
  );
}

/** 422 with the stop, no override path; the client can resubmit as
 *  `discard`, which always saves. */
export function stopResponse(stop: FoodStop) {
  return json(stop, { status: 422 });
}

export function warningsFor(check: FoodCheck | null): RecordWarning[] {
  return (check?.warnings ?? []).map((message) => ({ code: 'FOOD_USE_WARNING', message }));
}

/** C-05, C-35: a record saved more than 48 hours after the date it
 *  records ("Entered N days late"). A label only; no gate reads it. */
export function daysLate(occurredAt: number, createdAt: number): number | null {
  const late = createdAt - occurredAt;
  return late > LOCK_WINDOW_MS ? Math.floor(late / 86_400_000) : null;
}
