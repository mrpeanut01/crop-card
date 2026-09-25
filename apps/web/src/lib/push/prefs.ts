export const PUSH_ALERT_KINDS = ['decon-due', 'lock-window-closing', 'spring-calibration'] as const;

export type PushAlertKind = (typeof PUSH_ALERT_KINDS)[number];

export type PushPrefs = Record<PushAlertKind, boolean>;

export const PUSH_ALERT_LABELS: Record<PushAlertKind, { label: string; sub: string }> = {
  'decon-due': {
    label: 'Decon due',
    sub: 'A sprayer still carries chemistry an hour after its last spray.'
  },
  'lock-window-closing': {
    label: 'Record lock closing',
    sub: 'A spray, insecticide, or fungicide record locks for good in under 2 hours (FR-09).'
  },
  'spring-calibration': {
    label: 'Spring calibration',
    sub: 'A winterized sprayer needs recalibrating before the first spring spray.'
  }
};

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  'decon-due': true,
  'lock-window-closing': true,
  'spring-calibration': true
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
