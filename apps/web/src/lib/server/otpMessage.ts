/**
 * Wording for messages that carry a one-time code, shaped for Apple's
 * Security Code AutoFill (Messages on iPhone/Mac, and Mail on iOS 17 /
 * macOS Sonoma and later) and the matching Chrome/Android behaviour:
 *
 * - The last line is the origin-bound code line `@<host> #<code>` (WICG
 *   "origin-bound one-time codes"). Safari then offers the code only on
 *   that exact host, which also stops a look-alike site from getting it.
 *   `host` must equal the host of the page with the code field, so it is
 *   taken from ORIGIN, never from the request.
 * - The code sits next to the word "code" and is the only run of digits
 *   in the text; expiry times are spelled out and phone numbers are never
 *   echoed, so the heuristic parser can't pick the wrong number.
 * - The code field itself carries `autocomplete="one-time-code"`.
 */

import { t } from '$lib/i18n';
import { effectiveLocale } from './messageLocale';

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty'
];

const WORDS_ES = [
  'cero',
  'un',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte'
];

/** "fifteen minutes"; past twenty, "about half an hour"-style wording keeps
 *  digits out of the message. */
export function minutesInWords(ms: number, locale?: string | null): string {
  const loc = effectiveLocale(locale);
  const n = Math.max(1, Math.round(ms / 60_000));
  if (n === 1) return t(loc, 'sms.minutes.one');
  if (n <= 20) return t(loc, 'sms.minutes.words', { words: (loc === 'es' ? WORDS_ES : WORDS)[n] });
  if (n <= 45) return t(loc, 'sms.minutes.halfHour');
  return t(loc, 'sms.minutes.hour');
}

/** `@host #code`, or null when there is no usable origin (e.g. local dev
 *  without ORIGIN). */
export function originBoundLine(origin: string | null, code: string): string | null {
  if (!origin) return null;
  try {
    return `@${new URL(origin).host} #${code}`;
  } catch {
    return null;
  }
}

/** Joins body lines and appends the origin-bound line last, after a blank line. */
export function withOriginBoundLine(lines: string[], origin: string | null, code: string): string {
  const bound = originBoundLine(origin, code);
  return (bound ? [...lines, '', bound] : lines).join('\n');
}

export function smsLoginBody(
  code: string,
  ttlMs: number,
  origin: string | null,
  locale?: string | null
): string {
  const loc = effectiveLocale(locale);
  return withOriginBoundLine(
    [t(loc, 'sms.login', { code, expires: minutesInWords(ttlMs, loc) })],
    origin,
    code
  );
}

export function smsLinkBody(
  code: string,
  ttlMs: number,
  origin: string | null,
  locale?: string | null
): string {
  const loc = effectiveLocale(locale);
  return withOriginBoundLine(
    [t(loc, 'sms.link', { code, expires: minutesInWords(ttlMs, loc) })],
    origin,
    code
  );
}
