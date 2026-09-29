/**
 * 32D client HOLD evaluator (D1-01 to D1-06, D2-02, D2-03). It reads the
 * holds the server's kernel projected into the offline snapshot through the
 * card builders' pure reader (`readHolds`), adds this phone's own unsynced
 * treatments, moves and sprays, and never computes a clear date by itself. It can
 * only read more carefully than the server: an unsynced row, a stale or
 * missing snapshot, or other rules turn a "clear" into "can't confirm",
 * and a HOLD always shows as it is. The server stays authoritative when
 * the queue replays.
 */

import { readHolds, type HoldReading } from '$lib/cards/build/animalHolds';
import type { FarmSnapshot } from '$lib/cards/snapshot';
import {
  animalRecordKind,
  isAnimalQueueKind,
  lineageKeys,
  payloadSubjectKeys
} from '$lib/animals/queueRecovery';
import type { Food, ProductionUse } from '$lib/safety/animalWithdrawal';
import { GATED_USES } from '$lib/safety/animalWithdrawal';
import type { PendingSprayRecord } from './dexie';

const UNASSIGNED_OWNER_ID = '__unassigned__';

/** Queued kinds that put a grazing exposure hold on the animals living on
 *  the sprayed block's Area. */
const SPRAY_KINDS = new Set(['herbicide', 'insecticide', 'fungicide']);

/**
 * Subjects with a treatment, move or spray still on this phone for the
 * active Owner (D1-04): the subject itself, the group an animal lives in,
 * and the members of a treated or moved group. A care-task Done that
 * carries a treatment counts as a treatment. A queued pesticide spray
 * counts for every animal and group housed on the sprayed block's Area,
 * since the server holds their eggs, milk and meat for grazing exposure;
 * a spray on a block this snapshot does not know counts for every housed
 * subject. Other Owners' rows and rows with no known Owner never count.
 */
export function unsyncedSubjects(
  rows: readonly Pick<PendingSprayRecord, 'ownerId' | 'kind' | 'payload'>[],
  ownerId: string | null,
  snapshot:
    (Pick<FarmSnapshot, 'animals'> & Partial<Pick<FarmSnapshot, 'animalGroups' | 'blocks'>>) | null
): Set<string> {
  const out = new Set<string>();
  if (!ownerId || ownerId === UNASSIGNED_OWNER_ID) return out;
  for (const r of rows) {
    if (r.ownerId !== ownerId) continue;
    const kind = r.kind ?? 'herbicide';
    if (SPRAY_KINDS.has(kind)) {
      for (const k of sprayedSubjects(r.payload, snapshot)) out.add(k);
      continue;
    }
    const recordKind = animalRecordKind(kind, r.payload);
    if (recordKind !== 'animal-health' && recordKind !== 'animal-move') continue;
    for (const k of lineageKeys(payloadSubjectKeys(kind, r.payload), snapshot)) out.add(k);
  }
  return out;
}

function sprayedSubjects(
  payload: unknown,
  snapshot:
    (Pick<FarmSnapshot, 'animals'> & Partial<Pick<FarmSnapshot, 'animalGroups' | 'blocks'>>) | null
): string[] {
  if (!snapshot) return [];
  const blockId =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).blockId
      : undefined;
  const block =
    typeof blockId === 'string' ? snapshot.blocks?.find((b) => b.id === blockId) : undefined;
  const onArea = (fieldId: string | null) => !!fieldId && (block ? block.areaId === fieldId : true);
  const out: string[] = [];
  for (const a of snapshot.animals ?? []) if (onArea(a.housingFieldId)) out.push(`animal:${a.id}`);
  for (const g of snapshot.animalGroups ?? []) {
    if (onArea(g.housingFieldId)) out.push(`group:${g.id}`);
  }
  return [...lineageKeys(out, snapshot)];
}

/** Reads the active Owner's queue, plus the treatments, moves and sprays
 *  this phone saved online that the snapshot may not show yet
 *  (`onlineHoldWrites`). Empty when storage is unavailable. */
export async function loadUnsyncedSubjects(
  snapshot:
    (Pick<FarmSnapshot, 'animals'> & Partial<Pick<FarmSnapshot, 'animalGroups' | 'blocks'>>) | null
): Promise<Set<string>> {
  try {
    const { listPendingForActiveOwner } = await import('./syncQueue');
    const { listOnlineHoldWrites } = await import('./onlineHoldWrites');
    const { activeCardOwnerId } = await import('./cardStore');
    const rows = await listPendingForActiveOwner();
    const ownerId = activeCardOwnerId() ?? rows[0]?.ownerId ?? null;
    const online = listOnlineHoldWrites().map((w) => ({
      ownerId: ownerId ?? '',
      kind: w.kind,
      payload: w.payload
    }));
    return unsyncedSubjects([...rows, ...online], ownerId, snapshot);
  } catch {
    return new Set();
  }
}

export type FoodLogVerdict =
  /** A HOLD on this food: food or sale is refused; save as discard. */
  | 'hold'
  /** Nothing on file, but the phone can't confirm it. Allowed; the
   *  server decides on replay. */
  | 'unconfirmed'
  /** Nothing on file and the snapshot is current. */
  | 'clear'
  /** Discard, feed to animals, unknown or weight: never gated here. */
  | 'not-gated';

export interface FoodLogCheck {
  verdict: FoodLogVerdict;
  reading: HoldReading | null;
}

/**
 * The pre-check for an egg or milk log (D1-05). While the food shows HOLD
 * there is no offline override: the only way to save it is as discarded.
 */
export function checkFoodLog(input: {
  snapshot: FarmSnapshot | null;
  subject: string;
  food: Food | null;
  use: ProductionUse;
  now: number;
  unsynced?: ReadonlySet<string>;
  rulesVersion?: string;
}): FoodLogCheck {
  if (!input.food || !GATED_USES.includes(input.use))
    return { verdict: 'not-gated', reading: null };
  if (!input.snapshot) {
    return {
      verdict: 'unconfirmed',
      reading: { state: 'unconfirmed', holds: [], unconfirmedReason: 'no-data' }
    };
  }
  const keys = [...lineageKeys([input.subject], input.snapshot)];
  const direct = readHolds(
    input.snapshot,
    input.subject,
    [input.food],
    { now: input.now, unsynced: input.unsynced, rulesVersion: input.rulesVersion },
    keys
  );
  if (direct.state === 'held') return { verdict: 'hold', reading: direct };
  return { verdict: direct.state === 'clear' ? 'clear' : 'unconfirmed', reading: direct };
}

export type MovePrecheck =
  | { verdict: 'ok' }
  | { verdict: 'warn'; message: string }
  | { verdict: 'stop'; message: string; askOwner: boolean };

/**
 * The tap-time pre-check for a move onto an Area (D1-06, D2-02). A food
 * animal headed for an Area the snapshot shows on a grazing hold is
 * stopped and nothing is queued; pets and animals not used for food get a
 * warning. An Area with no hold on file passes: the server re-checks it
 * as a live move when the queue replays.
 */
export function precheckMove(input: {
  snapshot: FarmSnapshot | null;
  subjectType: 'animal' | 'group';
  subjectId: string;
  fieldId: string | null | undefined;
  role: string | null | undefined;
  now: number;
}): MovePrecheck {
  const { snapshot, fieldId } = input;
  if (!snapshot || !fieldId) return { verdict: 'ok' };
  const open = (snapshot.areaHolds ?? []).filter(
    (h) =>
      h.areaId === fieldId &&
      h.kind === 'graze' &&
      h.fromMs <= input.now &&
      (h.clearMs === null || h.clearMs > input.now)
  );
  if (open.length === 0) return { verdict: 'ok' };
  const area = snapshot.areas?.find((f) => f.id === fieldId)?.name ?? 'That Area';
  const foodProducing = subjectFoodProducing(snapshot, input.subjectType, input.subjectId);
  if (!foodProducing) {
    return {
      verdict: 'warn',
      message: `${area} was sprayed and is inside its grazing time. That is allowed for animals not used for food, but keep them off it if you can.`
    };
  }
  const helper = input.role !== 'owner';
  const unknown = open.some((h) => h.status !== 'held' || h.clearMs === null);
  const until = unknown
    ? 'until the owner adds the grazing time from the label'
    : 'until its grazing time is over';
  return {
    verdict: 'stop',
    askOwner: helper,
    message: `${area} was sprayed, so food animals can't go there ${until}. Nothing was saved.${helper ? ' Ask the owner.' : ' Pick another Area for them.'}`
  };
}

/** Unknown subjects count as food animals, the careful reading. */
export function subjectFoodProducing(
  snapshot: Pick<FarmSnapshot, 'animals' | 'animalGroups'>,
  type: 'animal' | 'group',
  id: string
): boolean {
  if (type === 'group')
    return snapshot.animalGroups?.find((g) => g.id === id)?.foodProducing ?? true;
  return snapshot.animals?.find((a) => a.id === id)?.foodProducing ?? true;
}

export { isAnimalQueueKind };
