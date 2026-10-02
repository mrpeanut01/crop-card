import { PUSH_ALERT_KINDS, pushAlertText, type PushAlertKind } from '$lib/push/prefs';

/** Email alert categories mirror the push alert kinds one to one. */
export const EMAIL_ALERT_CATEGORIES = PUSH_ALERT_KINDS;

export type EmailAlertCategory = PushAlertKind;

export type EmailAlertPrefs = Record<EmailAlertCategory, boolean>;

/** Every category starts off. Email is opt-in only. */
export const DEFAULT_EMAIL_ALERT_PREFS: EmailAlertPrefs = {
  'decon-due': false,
  'lock-window-closing': false,
  'spring-calibration': false,
  'frost-tonight': false,
  'animal-care-due': false,
  'withdrawal-clears': false,
  'hold-covers-sale': false,
  'weekly-digest': false
};

export function isEmailAlertCategory(value: unknown): value is EmailAlertCategory {
  return typeof value === 'string' && (EMAIL_ALERT_CATEGORIES as readonly string[]).includes(value);
}

export function emailAlertLabel(category: EmailAlertCategory, locale?: string | null): string {
  return pushAlertText(category, 'label', locale);
}
