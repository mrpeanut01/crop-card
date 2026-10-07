import { t, type MessageKey } from '$lib/i18n';
import { numberToLocaleString } from '$lib/intlCache';
import { intlLocale } from '$lib/prefs';

/** One Zod issue as the API returns it in `issues`. */
export interface RefusalIssue {
  code?: string;
  path?: ReadonlyArray<string | number>;
  maximum?: number | string;
  minimum?: number | string;
}

export interface RefusalBody {
  error?: unknown;
  issues?: unknown;
}

const FIELD_KEYS: Record<string, MessageKey> = {
  quantityPlants: 'wizard.refusal.field.plants',
  plants: 'wizard.refusal.field.plants',
  plannedPlants: 'wizard.refusal.field.plants',
  plantCount: 'wizard.refusal.field.plants',
  areaSqFt: 'wizard.refusal.field.area',
  quantityPlanted: 'wizard.refusal.field.quantity'
};

function firstIssue(body: RefusalBody | null | undefined): RefusalIssue | null {
  const issues = body?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const first = issues[0];
  return first && typeof first === 'object' ? (first as RefusalIssue) : null;
}

function num(v: unknown, locale: string | undefined): string {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? numberToLocaleString(n, intlLocale(locale)) : String(v ?? '');
}

/**
 * #688 #722: a readable reason for a refused planning request. Names the
 * seed (`seedNames[i]` for a `seedSelections.i` / `seeds.i` path) and the
 * field, and says what to change, instead of the bare "invalid request".
 */
export function planRefusalText(
  body: RefusalBody | null | undefined,
  status: number,
  locale: string | undefined,
  seedNames: ReadonlyArray<string> = []
): string {
  const issue = firstIssue(body);
  const error = typeof body?.error === 'string' && body.error ? body.error : null;
  if (!issue) return error ?? t(locale, 'wizard.refusal.http', { status });

  const path = issue.path ?? [];
  const field = [...path].reverse().find((p): p is string => typeof p === 'string') ?? '';
  const fieldName = FIELD_KEYS[field] ? t(locale, FIELD_KEYS[field]) : field;
  const seedIndex =
    (path[0] === 'seedSelections' || path[0] === 'seeds') && typeof path[1] === 'number'
      ? path[1]
      : null;
  const seed = seedIndex !== null ? seedNames[seedIndex] : undefined;

  if (issue.code === 'too_big' && issue.maximum !== undefined) {
    const max = num(issue.maximum, locale);
    return seed
      ? t(locale, 'wizard.refusal.seedTooBig', { seed, field: fieldName, max })
      : t(locale, 'wizard.refusal.tooBig', { field: fieldName, max });
  }
  if (issue.code === 'too_small' && issue.minimum !== undefined) {
    const min = num(issue.minimum, locale);
    return seed
      ? t(locale, 'wizard.refusal.seedTooSmall', { seed, field: fieldName, min })
      : t(locale, 'wizard.refusal.tooSmall', { field: fieldName, min });
  }
  return seed
    ? t(locale, 'wizard.refusal.seedInvalid', { seed, field: fieldName })
    : t(locale, 'wizard.refusal.invalid', { field: fieldName || (error ?? '') });
}

/** A refused request that would fail the same way again: a 4xx other than
 *  a timeout, a too-early or a rate limit. Network errors and 5xx retry. */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 425 || status === 429) return true;
  return status < 400 || status >= 500;
}
