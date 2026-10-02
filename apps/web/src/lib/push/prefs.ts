import { t, type MessageKey } from '$lib/i18n';

export const PUSH_ALERT_KINDS = [
  'decon-due',
  'lock-window-closing',
  'spring-calibration',
  'frost-tonight',
  'animal-care-due',
  'withdrawal-clears',
  'hold-covers-sale',
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
  'hold-covers-sale': {
    label: 'Hold now covers a sale',
    sub: 'A later record put egg, milk or meat records you already saved inside a hold. Owner only.'
  },
  'weekly-digest': {
    label: 'Monday summary',
    sub: "One summary of the week's tasks every Monday morning. Safety alerts still come on their own."
  }
};

/** An alert's label or explanation for the settings and unsubscribe pages. */
export function pushAlertText(
  kind: PushAlertKind,
  part: 'label' | 'sub',
  locale?: string | null
): string {
  const english = PUSH_ALERT_LABELS[kind][part];
  if (!locale) return english;
  const key = `settings.notif.${kind}.${part}` as MessageKey;
  return t('en', key) === english ? t(locale, key) : english;
}

/** Kinds added after devices had already saved their choices. A device
 *  that saved before a kind existed keeps it off until the user turns it
 *  on (D0-16). `hold-covers-sale` is a food-safety alert, so it is not
 *  here and saved devices get it on (G3-06). */
export const PUSH_KINDS_ADDED_LATER: readonly PushAlertKind[] = [
  'animal-care-due',
  'withdrawal-clears',
  'weekly-digest'
];

/** Kinds only an owner receives, so helpers never see the toggle. */
export const OWNER_ONLY_PUSH_KINDS: readonly PushAlertKind[] = [
  'withdrawal-clears',
  'hold-covers-sale'
];

/** Kinds about animals, shown once the farm has animals. */
export const ANIMAL_PUSH_KINDS: readonly PushAlertKind[] = [
  'animal-care-due',
  'withdrawal-clears',
  'hold-covers-sale'
];

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  'decon-due': true,
  'lock-window-closing': true,
  'spring-calibration': true,
  'frost-tonight': false,
  'animal-care-due': true,
  'withdrawal-clears': false,
  'hold-covers-sale': true,
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
