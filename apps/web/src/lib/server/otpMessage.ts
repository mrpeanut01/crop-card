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

/** "fifteen minutes"; past twenty, "about half an hour"-style wording keeps
 *  digits out of the message. */
export function minutesInWords(ms: number): string {
  const n = Math.max(1, Math.round(ms / 60_000));
  if (n === 1) return 'one minute';
  if (n <= 20) return `${WORDS[n]} minutes`;
  if (n <= 45) return 'about half an hour';
  return 'about an hour';
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

export function smsLoginBody(code: string, ttlMs: number, origin: string | null): string {
  return withOriginBoundLine(
    [
      `Your CropCard sign-in code is ${code}. It expires in ${minutesInWords(ttlMs)}. Don't share it with anyone.`
    ],
    origin,
    code
  );
}

export function smsLinkBody(code: string, ttlMs: number, origin: string | null): string {
  return withOriginBoundLine(
    [
      `Your CropCard verification code is ${code}. Enter it to add this number to your account. It expires in ${minutesInWords(ttlMs)}.`
    ],
    origin,
    code
  );
}
