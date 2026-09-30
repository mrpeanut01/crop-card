export const PUSH_ALERT_KINDS = [
  'decon-due',
  'lock-window-closing',
  'spring-calibration',
  'frost-tonight',
  'animal-care-due',
  'withdrawal-clears',
  'weekly-digest'
] as const;

export type PushAlertKind = (typeof PUSH_ALERT_KINDS)[number];

export type PushPrefs = Record<PushAlertKind, boolean>;

export const PUSH_ALERT_LABELS: Record<PushAlertKind, { label: string; sub: string }> = {
  'decon-due': {
    label: 'Decon due',
    sub: 'A sprayer still carries chemistry an hour after its last spray.'
  },
  'lock-window-closing': {
    label: 'Record lock closing',
    sub: 'A spray, insecticide, or fungicide record locks for good in under 2 hours.'
  },
  'spring-calibration': {
    label: 'Spring calibration',
    sub: 'A winterized sprayer needs recalibrating before the first spring spray.'
  },
  'frost-tonight': {
    label: 'Frost tonight',
    sub: 'The National Weather Service issues a frost or freeze advisory for your farm while frost-tender crops are planted or about to be.'
  },
  'animal-care-due': {
    label: 'Animal care due',
    sub: 'A care plan for an animal or group comes up, and again on the day it is due.'
  },
  'withdrawal-clears': {
    label: 'Hold cleared',
    sub: 'An egg, milk or meat hold on an animal or group has ended. Owner only.'
  },
  'weekly-digest': {
    label: 'Monday summary',
    sub: "One summary of the week's tasks every Monday morning. Safety alerts still come on their own."
  }
};

/** Kinds added after devices had already saved their choices. A device
 *  that saved before a kind existed keeps it off until the user turns it
 *  on (D0-16). */
export const PUSH_KINDS_ADDED_LATER: readonly PushAlertKind[] = [
  'animal-care-due',
  'withdrawal-clears',
  'weekly-digest'
];

/** Kinds only an owner receives, so helpers never see the toggle. */
export const OWNER_ONLY_PUSH_KINDS: readonly PushAlertKind[] = ['withdrawal-clears'];

/** Kinds about animals, shown once the farm has animals. */
export const ANIMAL_PUSH_KINDS: readonly PushAlertKind[] = ['animal-care-due', 'withdrawal-clears'];

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  'decon-due': true,
  'lock-window-closing': true,
  'spring-calibration': true,
  'frost-tonight': false,
  'animal-care-due': true,
  'withdrawal-clears': false,
  'weekly-digest': false
};

export function isPushAlertKind(value: unknown): value is PushAlertKind {
  return typeof value === 'string' && (PUSH_ALERT_KINDS as readonly string[]).includes(value);
}

export function parsePushPrefs(raw: string | null | undefined): PushPrefs {
  const out: PushPrefs = { ...DEFAULT_PUSH_PREFS };
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const kind of PUSH_ALERT_KINDS) {
    const v = (parsed as Record<string, unknown>)[kind];
    if (typeof v === 'boolean') out[kind] = v;
    else if (PUSH_KINDS_ADDED_LATER.includes(kind)) out[kind] = false;
  }
  return out;
}

export function mergePushPrefs(current: PushPrefs, patch: unknown): PushPrefs {
  const out: PushPrefs = { ...current };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
  for (const kind of PUSH_ALERT_KINDS) {
    const v = (patch as Record<string, unknown>)[kind];
    if (typeof v === 'boolean') out[kind] = v;
  }
  return out;
}
