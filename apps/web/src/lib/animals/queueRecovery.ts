/**
 * 32D offline recovery: what a queued animal record the server refused can
 * do next (D0-11, D1-06 to D1-09, D2-01, D2-02). Pure and client-safe, so
 * the sync queue, the pending page and the tests share one reading.
 *
 * Nothing here decides a hold. It maps the server's refusal to the ways
 * out the server already accepts: a production log saved as discarded, a
 * move dropped or re-sent as one that already happened, a record re-dated.
 */

import type { FarmSnapshot } from '$lib/cards/snapshot';

/** The kinds this module knows about. Other kinds get Retry and Delete. */
export type AnimalQueueKind = 'animal-production' | 'animal-health' | 'animal-move';

export const ANIMAL_QUEUE_KINDS: readonly AnimalQueueKind[] = [
  'animal-production',
  'animal-health',
  'animal-move'
];

export function isAnimalQueueKind(kind: string | undefined): kind is AnimalQueueKind {
  return !!kind && (ANIMAL_QUEUE_KINDS as readonly string[]).includes(kind);
}

/** The treatment a queued care-task Done carries (32D), or null. Such a
 *  `task` row is an animal-health record for holds, queue order and the
 *  pending copy. */
export function carriedHealthEvent(
  kind: string | undefined,
  payload: unknown
): Record<string, unknown> | null {
  if (kind !== 'task' || !payload || typeof payload !== 'object') return null;
  const h = (payload as Record<string, unknown>).healthEvent;
  return h && typeof h === 'object' && !Array.isArray(h) ? (h as Record<string, unknown>) : null;
}

/** The animal record kind a queued row stands for, counting a care-task
 *  Done with a treatment as `animal-health`. */
export function animalRecordKind(
  kind: string | undefined,
  payload: unknown
): AnimalQueueKind | null {
  if (isAnimalQueueKind(kind)) return kind;
  return carriedHealthEvent(kind, payload) ? 'animal-health' : null;
}

/** The parts of a refusal body the recovery reads. */
export interface RejectInfo {
  code?: string;
  error?: string;
  askOwner?: boolean;
  resubmitAs?: 'discard';
  fieldId?: string | null;
}

/** Reads the refusal body the server sent. Never throws. */
export function rejectInfoOf(body: string): RejectInfo | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const p = parsed as Record<string, unknown>;
  const out: RejectInfo = {};
  if (typeof p.code === 'string') out.code = p.code.slice(0, 64);
  if (typeof p.error === 'string') out.error = p.error.slice(0, 600);
  if (p.askOwner === true) out.askOwner = true;
  if (p.resubmitAs === 'discard') out.resubmitAs = 'discard';
  if (typeof p.fieldId === 'string') out.fieldId = p.fieldId;
  return Object.keys(out).length ? out : undefined;
}

export type RecoveryAction =
  'save-as-discard' | 'keep-here' | 'already-went' | 'record-now' | 'redate' | 'retry';

export interface Recovery {
  /** The one full-width action, when there is one. */
  primary: RecoveryAction | null;
  /** Every action offered, primary first. "Delete from phone" is always
   *  there too, in the overflow menu. */
  actions: RecoveryAction[];
  /** Only the owner can unblock it; the row stays until they do. */
  askOwner: boolean;
}

const GATED_USES = new Set(['food', 'sale']);

function isGrazingStop(code: string | undefined): boolean {
  return !!code && code.startsWith('GRAZING_');
}

/** What a parked row offers (D1-07). */
export function recoveryFor(row: {
  kind?: string;
  lastStatus?: number;
  rejectInfo?: RejectInfo;
  payload: unknown;
}): Recovery {
  const info = row.rejectInfo ?? {};
  const status = row.lastStatus ?? 0;
  const askOwner = info.askOwner === true || status === 403;
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  if (
    row.kind === 'animal-production' &&
    status === 422 &&
    (info.resubmitAs === 'discard' || GATED_USES.has(String(payload.use)))
  ) {
    return { primary: 'save-as-discard', actions: ['save-as-discard'], askOwner };
  }
  if (row.kind === 'animal-move' && status === 422 && isGrazingStop(info.code)) {
    const unknownForHelper = askOwner && info.code === 'GRAZING_UNKNOWN';
    return {
      primary: 'keep-here',
      actions: unknownForHelper ? ['keep-here'] : ['keep-here', 'already-went'],
      askOwner
    };
  }
  if (isAnimalQueueKind(row.kind) && info.code === 'OUT_OF_ORDER') {
    return { primary: 'record-now', actions: ['record-now'], askOwner };
  }
  if (isAnimalQueueKind(row.kind) && info.code === 'STAY_HAS_GRAZING_HOLD') {
    return { primary: null, actions: ['redate', 'record-now'], askOwner };
  }
  return { primary: null, actions: ['retry'], askOwner };
}

export const RECOVERY_LABEL: Record<RecoveryAction, string> = {
  'save-as-discard': 'Save as discard',
  'keep-here': 'Keep animals here',
  'already-went': 'They already went through the gate',
  'record-now': 'Record it now',
  redate: 'Re-date after the spray',
  retry: 'Retry'
};

/** The field that dates each kind's payload. */
export const DATE_FIELD: Record<AnimalQueueKind, 'occurredAt' | 'movedAt' | 'administeredAt'> = {
  'animal-production': 'occurredAt',
  'animal-move': 'movedAt',
  'animal-health': 'administeredAt'
};

/** Marks a move that was tapped while offline. The server judges it as a
 *  live move at its tapped-at time, so a grazing hold answers 422 instead
 *  of saving it as a move that already happened (D1-06). */
export const QUEUED_LIVE_FIELD = 'queuedLive';

/** Marks the "They already went through the gate" resend: the server saves
 *  the move as one that already happened (food held) even when it was
 *  tapped less than 30 minutes ago. */
export const ALREADY_THERE_FIELD = 'alreadyThere';

/**
 * The payload a recovery re-sends, under the same client record id
 * (D0-11). Pure. Returns null for an action that sends nothing
 * (`keep-here` drops the row) or does not apply to the payload.
 */
export function rewriteForRecovery(
  kind: string | undefined,
  payload: unknown,
  action: RecoveryAction,
  opts: { now: number; at?: number } = { now: Date.now() }
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = { ...(payload as Record<string, unknown>) };
  switch (action) {
    case 'save-as-discard': {
      if (kind !== 'animal-production') return null;
      const was = p.convertedFromUse ?? p.use;
      p.use = 'discard';
      if (typeof was === 'string' && GATED_USES.has(was)) p.convertedFromUse = was;
      return p;
    }
    case 'already-went': {
      if (kind !== 'animal-move') return null;
      delete p[QUEUED_LIVE_FIELD];
      p[ALREADY_THERE_FIELD] = true;
      return p;
    }
    case 'record-now':
    case 'redate': {
      if (!isAnimalQueueKind(kind)) return null;
      const at = action === 'redate' ? opts.at : opts.now;
      if (typeof at !== 'number' || !Number.isFinite(at)) return null;
      const field = DATE_FIELD[kind];
      const before = p[field];
      p[field] = Math.min(Math.round(at), opts.now);
      if (
        kind === 'animal-health' &&
        typeof p.courseEndAt === 'number' &&
        typeof before === 'number' &&
        p.courseEndAt < (p[field] as number)
      ) {
        p.courseEndAt = p[field];
      }
      return p;
    }
    case 'keep-here':
    case 'retry':
      return null;
  }
}

/** Confirm text for "Delete from phone" (D2-01). */
export function deleteConfirmText(kind: string | undefined, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (kind === 'animal-production') {
    const what =
      p.kind === 'milk' ? 'The milk was' : p.kind === 'weight' ? 'The weight was' : 'The eggs were';
    return `This record will be lost. ${what} still collected.`;
  }
  if (kind === 'animal-health' || carriedHealthEvent(kind, payload))
    return 'This record will be lost. The treatment was still given.';
  if (kind === 'animal-move') return 'This record will be lost. The move will not be on file.';
  return 'This record will be lost.';
}

/** Keys (`animal:<id>`, `group:<id>`) a queued animal payload touches. */
export function payloadSubjectKeys(kind: string | undefined, payload: unknown): string[] {
  const carried = carriedHealthEvent(kind, payload);
  if (carried) return payloadSubjectKeys('animal-health', carried);
  if (!isAnimalQueueKind(kind)) return [];
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const out: string[] = [];
  if (
    (p.subjectType === 'animal' || p.subjectType === 'group') &&
    typeof p.subjectId === 'string'
  ) {
    out.push(`${p.subjectType}:${p.subjectId}`);
  }
  if (kind === 'animal-move') {
    if (typeof p.toGroupId === 'string') out.push(`group:${p.toGroupId}`);
    if (Array.isArray(p.animalIds)) {
      for (const id of p.animalIds) if (typeof id === 'string') out.push(`animal:${id}`);
    }
  }
  return out;
}

/**
 * The subject lineage for queue ordering and the unsynced chip (D1-04,
 * D1-09): an animal and the group it lives in, a group and its members.
 * With no snapshot, only the keys themselves.
 */
export function lineageKeys(
  keys: readonly string[],
  snapshot: Pick<FarmSnapshot, 'animals'> | null | undefined
): Set<string> {
  const out = new Set(keys);
  const animals = snapshot?.animals ?? [];
  for (const key of keys) {
    const [type, id] = splitKey(key);
    if (type === 'animal') {
      const a = animals.find((x) => x.id === id);
      if (a?.groupId) out.add(`group:${a.groupId}`);
    } else if (type === 'group') {
      for (const a of animals) if (a.groupId === id) out.add(`animal:${a.id}`);
    }
  }
  return out;
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf(':');
  return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i + 1)];
}

/** A short line for the pending list. */
export function pendingSummary(kind: string | undefined, payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (kind === 'animal-production') {
    const use =
      p.use === 'food'
        ? 'for food'
        : p.use === 'sale'
          ? 'for sale'
          : p.use === 'discard'
            ? 'thrown out'
            : p.use === 'feed-to-animals'
              ? 'fed to animals'
              : 'use not known';
    return `${String(p.quantity ?? '')} ${String(p.unit ?? '')}, ${use}`.trim();
  }
  if (kind === 'animal-health') {
    const name = typeof p.productName === 'string' && p.productName ? `: ${p.productName}` : '';
    return `Treatment${name}`;
  }
  if (kind === 'animal-move') return 'Animal move';
  const carried = carriedHealthEvent(kind, payload);
  if (carried) {
    const name =
      typeof carried.productName === 'string' && carried.productName
        ? `: ${carried.productName}`
        : '';
    return `Care done with a treatment${name}`;
  }
  if (kind === 'feed-use') {
    return typeof p.lb === 'number' ? `Feed used, ${p.lb} lb` : 'Feed used';
  }
  if (kind === 'seed-start') {
    return typeof p.germinatedCount === 'number'
      ? `${p.germinatedCount} seedlings up`
      : 'Tray progress';
  }
  return null;
}

export const KIND_LABEL: Record<string, string> = {
  herbicide: 'Herbicide spray',
  insecticide: 'Insecticide spray',
  fungicide: 'Fungicide spray',
  harvest: 'Harvest',
  'hay-cutting': 'Hay cutting',
  scout: 'Scouting',
  task: 'Task',
  journal: 'Journal',
  'animal-move': 'Animal move',
  'animal-health': 'Animal treatment',
  'animal-production': 'Eggs, milk or weight',
  'feed-use': 'Feed use',
  'seed-start': 'Seed tray',
  irrigation: 'Watering',
  'rain-gauge': 'Rain gauge reading'
};
