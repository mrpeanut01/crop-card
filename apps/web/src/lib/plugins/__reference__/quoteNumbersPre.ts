/**
 * Test-only: the quote-number and PPLS file-name helpers exactly as they
 * stood in `sourceCoverage.ts`, `pesticideLabelSources.ts` and
 * `earlierRegistration.ts` before they moved into `quoteNumbers.ts` and
 * `scripts/lib/pplsFile.mjs`. `quoteNumbers.equivalence.test.ts` checks the
 * shared helpers against these over every quote the sources files hold.
 * Never import this outside tests.
 */

const NUMBER_WORDS = [
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
  'ten'
];

export function statesDays(quote: string, days: number): boolean {
  if (new RegExp(`(^|[^\\d.])${days}([^\\d]|$)`).test(quote) && /\bdays?\b/i.test(quote)) {
    return true;
  }
  if (days % 7 !== 0 || !/\bweeks?\b/i.test(quote)) return false;
  const w = days / 7;
  return (
    new RegExp(`(^|[^\\d.])${w}([^\\d]|$)`).test(quote) ||
    (NUMBER_WORDS[w] !== undefined && new RegExp(`\\b${NUMBER_WORDS[w]}\\b`, 'i').test(quote))
  );
}

const FEET_WORDS = [
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
  'twelve'
];

const INCH_FRACTIONS: Record<string, string[]> = {
  '.25': ['1/4', '¼'],
  '.5': ['1/2', '½'],
  '.75': ['3/4', '¾']
};

function fractionPatterns(n: number): string[] {
  const whole = Math.floor(n);
  const forms = INCH_FRACTIONS[String(n - whole).replace(/^0/, '')];
  if (!forms) return [];
  return forms.map((f) => (whole === 0 ? f : `${whole}(?:[- ]|\\s)?${f}`));
}

export function numberPattern(n: number): string {
  const [int, frac] = String(n).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+$)/g, ',?');
  return frac ? `${grouped}\\.${frac}` : grouped;
}

export function statesInches(quote: string, inches: number): boolean {
  const figures = [numberPattern(inches), ...fractionPatterns(inches)];
  const feet = inches / 12;
  if (Number.isInteger(feet) || Number.isInteger(feet * 2)) {
    figures.push(numberPattern(feet), ...fractionPatterns(feet));
  }
  if (figures.some((f) => new RegExp(`(^|[^\\d.])${f}([^\\d]|$)`).test(quote))) return true;
  const word = Number.isInteger(feet) ? FEET_WORDS[feet - 1] : undefined;
  if (word && new RegExp(`\\b${word}[- ](foot|feet)\\b`, 'i').test(quote)) return true;
  const inchWord = Number.isInteger(inches) ? FEET_WORDS[inches - 1] : undefined;
  return !!inchWord && /\binch/i.test(quote) && new RegExp(`\\b${inchWord}\\b`, 'i').test(quote);
}

function statesNumber(quote: unknown, n: number): boolean {
  return typeof quote === 'string' && new RegExp(`(^|[^0-9.])${n}([^0-9]|$)`).test(quote);
}

const WEEK_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export function statesPhiDays(quote: unknown, n: number): boolean {
  if (statesNumber(quote, n)) return true;
  if (typeof quote !== 'string') return false;
  if (n > 0 && n % 7 === 0) {
    const w = n / 7;
    const forms = [String(w), ...(w <= WEEK_WORDS.length ? [WEEK_WORDS[w - 1]] : [])];
    if (forms.some((f) => new RegExp(`(^|[^0-9a-z])${f}[ -]weeks?\\b`, 'i').test(quote)))
      return true;
  }
  return (
    n === 0 &&
    /\b(the|up to(?: and including)?(?: the)?)(?: \.\.\.)? day(?: \.\.\.)? of(?: \.\.\.)? harvest\b/i.test(
      quote
    )
  );
}

const AMOUNT_FRACTIONS: Record<string, readonly string[]> = {
  '0.25': ['1/4', '¼'],
  '0.5': ['1/2', '½'],
  '0.75': ['3/4', '¾']
};

export function statesAmount(quote: unknown, n: number): boolean {
  if (typeof quote !== 'string') return false;
  if (statesNumber(quote, n)) return true;
  const whole = Math.floor(n);
  const frac = AMOUNT_FRACTIONS[String(Math.round((n - whole) * 100) / 100)];
  if (!frac) return false;
  return frac.some((f) => {
    const forms = whole === 0 ? [f] : [`${whole} ${f}`, `${whole}${f}`];
    return forms.some((form) => {
      const esc = form.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      return new RegExp(`(^|[^0-9/])${esc}([^0-9/]|$)`).test(quote);
    });
  });
}

export function pplsStem(reg: string): string | null {
  const m = /^(\d+)-(\d+)$/.exec(reg);
  return m ? `${m[1].padStart(6, '0')}-${m[2].padStart(5, '0')}` : null;
}

const PPLS_FILE = /\/ppls\/(\d+)-(\d+)-(\d{8})\.pdf$/i;

export function pplsLabelRegistration(
  url: unknown
): { registration: string; stamped: string } | null {
  if (typeof url !== 'string') return null;
  const m = PPLS_FILE.exec(url.trim().split(/[?#]/)[0]);
  if (!m) return null;
  const [, company, product, date] = m;
  return {
    registration: `${Number(company)}-${Number(product)}`,
    stamped: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  };
}
