/**
 * Date-order checks for records that end a subject's time somewhere: a
 * group split, a grouped animal leaving or changing group, and a slaughter
 * or sale for meat. A dose or a move already on record shows where the
 * animals were and that they were alive, so a later record dated before it
 * cannot be true. Without these checks a backdated split, leave or meat
 * declaration would cut the membership, lineage or stay windows the food
 * gate reads, and drop withdrawal and grazing exposure holds.
 */

import { listLocationsForSubject, type AnimalLocation } from '$lib/db/animalLocations';
import { formatClearDate, physicalWindow } from '$lib/safety/animalWithdrawal';
import { foodSubjectFor } from './animalRecords';
import { latestDoseFor, type SubjectType } from './animalFoodGate';
import { AnimalRuleError, type MovePlan } from './animals';

function lastMoment(stays: readonly AnimalLocation[]): number | null {
  let out: number | null = null;
  for (const s of stays) {
    const m = Math.max(s.fromMs, s.toMs ?? s.fromMs);
    if (out === null || m > out) out = m;
  }
  return out;
}

/** The latest recorded move that carried this subject: its own rows, and
 *  for an animal, its groups' moves while it was a member. */
export function latestMoveFor(subjectType: SubjectType, subjectId: string): number | null {
  let out = lastMoment(listLocationsForSubject(subjectType, subjectId));
  if (subjectType !== 'animal') return out;
  const ctx = foodSubjectFor('animal', subjectId);
  if (!ctx || ctx.subject.type !== 'animal') return out;
  for (const m of ctx.subject.memberships.map(physicalWindow)) {
    for (const s of listLocationsForSubject('group', m.groupId)) {
      const from = m.fromMs ?? Number.NEGATIVE_INFINITY;
      const to = m.toMs ?? Number.POSITIVE_INFINITY;
      if (s.fromMs < from || s.fromMs >= to) continue;
      if (out === null || s.fromMs > out) out = s.fromMs;
    }
  }
  return out;
}

interface Bound {
  atMs: number;
  dose: { product: string } | null;
}

function later(a: Bound | null, b: Bound | null): Bound | null {
  if (!a) return b;
  if (!b) return a;
  return b.atMs > a.atMs ? b : a;
}

function doseBound(subjectType: SubjectType, subjectId: string): Bound | null {
  const dose = latestDoseFor(subjectType, subjectId);
  return dose ? { atMs: dose.atMs, dose: { product: dose.product } } : null;
}

function moveBound(subjectType: SubjectType, subjectId: string): Bound | null {
  const at = latestMoveFor(subjectType, subjectId);
  return at === null ? null : { atMs: at, dose: null };
}

function refusal(bound: Bound, what: string, timeZone: string): AnimalRuleError {
  const when = formatClearDate(bound.atMs, timeZone);
  const message = bound.dose
    ? `${bound.dose.product} was given on ${when}, after this date, so the animals were still in the group then. Date the ${what} on or after that treatment.`
    : `A move on ${when} is already on record for these animals. Date the ${what} on or after it.`;
  return new AnimalRuleError('OUT_OF_ORDER', 409, message);
}

/**
 * A split, a grouped animal leaving for an Area, and a grouped animal
 * changing group all end time in a group. None of them may be dated before
 * the latest dose that reached the leavers or the latest move of the group
 * they leave. Whole-group moves and ungrouped animals end no membership, so
 * they are not checked here.
 */
export function moveOrderRefusal(plan: MovePlan, timeZone: string): AnimalRuleError | null {
  let bound: Bound | null = null;
  let what = 'move';
  if (plan.kind === 'group-split') {
    what = 'split';
    bound = later(moveBound('group', plan.group.id), doseBound('group', plan.group.id));
    for (const member of plan.members) {
      bound = later(bound, later(moveBound('animal', member.id), doseBound('animal', member.id)));
    }
  } else if (
    (plan.kind === 'animal-to-area' || plan.kind === 'animal-to-group') &&
    plan.animal.groupId
  ) {
    what = plan.kind === 'animal-to-group' ? 'group change' : 'move';
    bound = later(
      later(moveBound('group', plan.animal.groupId), moveBound('animal', plan.animal.id)),
      doseBound('animal', plan.animal.id)
    );
  }
  if (!bound || plan.movedAt >= bound.atMs) return null;
  return refusal(bound, what, timeZone);
}

/**
 * C-17 and C-30: a slaughter or sale for meat dated before the latest move
 * that carried the animals. The move shows they were alive and there then,
 * so the backdated date would drop the exposure hold that move created.
 */
export function meatMoveOrderRefusal(
  subjectType: SubjectType,
  subjectId: string,
  occurredAt: number,
  timeZone: string
): AnimalRuleError | null {
  const at = latestMoveFor(subjectType, subjectId);
  if (at === null || occurredAt >= at) return null;
  return new AnimalRuleError(
    'OUT_OF_ORDER',
    409,
    `A move on ${formatClearDate(at, timeZone)} is on record after this date, so the ${subjectType === 'group' ? 'animals were' : 'animal was'} still alive then. Date it on or after that move.`
  );
}
