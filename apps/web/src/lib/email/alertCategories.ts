import { PUSH_ALERT_KINDS, PUSH_ALERT_LABELS, type PushAlertKind } from '$lib/push/prefs';

/** Email alert categories mirror the push alert kinds one to one. */
export const EMAIL_ALERT_CATEGORIES = PUSH_ALERT_KINDS;

export type EmailAlertCategory = PushAlertKind;

export type EmailAlertPrefs = Record<EmailAlertCategory, boolean>;

/** Every category starts off. Email is opt-in only. */
export const DEFAULT_EMAIL_ALERT_PREFS: EmailAlertPrefs = {
  'decon-due': false,
  'lock-window-closing': false,
  'spring-calibration': false,
  'frost-tonight': false
};

export function isEmailAlertCategory(value: unknown): value is EmailAlertCategory {
  return typeof value === 'string' && (EMAIL_ALERT_CATEGORIES as readonly string[]).includes(value);
}

export function emailAlertLabel(category: EmailAlertCategory): string {
  return PUSH_ALERT_LABELS[category].label;
}
