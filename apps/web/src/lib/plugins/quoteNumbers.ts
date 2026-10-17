/**
 * How the source gates read a number in a quote: as digits, as a word, as
 * whole weeks, or as a label fraction. Each gate keeps its own acceptance
 * set (the day gate needs "days" somewhere in the quote, the PHI gate wants
 * "N weeks" together and reads "day of harvest" as 0, the inch gate takes
 * "1-1/2" where the amount gate does not), so the tables and the figure
 * match are shared and each reading stays as the gate wrote it.
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
  'ten',
  'eleven',
  'twelve'
] as const;

/** The word for a whole number from `min` to `max` ("seven"), else
 *  undefined. */
export function numberWord(n: number, max: number, min = 1): string | undefined {
  return Number.isInteger(n) && n >= min && n <= max ? NUMBER_WORDS[n] : undefined;
}

/** Fractions sources print instead of decimals ("3/4-1 in", "1½", "½ pint"). */
const FRACTION_FORMS = new Map<string, readonly string[]>([
  ['0.25', ['1/4', '¼']],
  ['0.5', ['1/2', '½']],
  ['0.75', ['3/4', '¾']]
]);

/** The printed forms of a fraction part of a number (0.25, 0.5, 0.75 only). */
export function fractionForms(fraction: number): readonly string[] | undefined {
  return FRACTION_FORMS.get(String(fraction));
}

/** A figure (a regex source) stands on its own in the quote: no digit or
 *  decimal point just before it and no digit just after. */
export function statesFigure(quote: string, pattern: string): boolean {
  return new RegExp(`(^|[^0-9.])${pattern}([^0-9]|$)`).test(quote);
}

export function statesNumber(quote: unknown, n: number): boolean {
  return typeof quote === 'string' && statesFigure(quote, String(n));
}

/** A number as a regex source, thousands separators optional ("1,?000"). */
export function numberPattern(n: number): string {
  const [int, frac] = String(n).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+$)/g, ',?');
  return frac ? `${grouped}\\.${frac}` : grouped;
}

/** A day offset is stated as days ("28 days") or, for whole weeks, as weeks
 *  in digits or words ("four to five weeks", "3-4 weeks"). */
export function statesDays(quote: string, days: number): boolean {
  if (statesNumber(quote, days) && /\bdays?\b/i.test(quote)) return true;
  if (days % 7 !== 0 || !/\bweeks?\b/i.test(quote)) return false;
  const w = days / 7;
  const word = numberWord(w, 10, 0);
  return (
    statesNumber(quote, w) || (word !== undefined && new RegExp(`\\b${word}\\b`, 'i').test(quote))
  );
}

/** A PHI quote states its days as a number, as whole weeks ("three weeks
 *  prior to harvest" for 21), or a 0-day PHI as the label's "day of harvest"
 *  wording ("May be applied the day of harvest."). */
export function statesPhiDays(quote: unknown, n: number): boolean {
  if (statesNumber(quote, n)) return true;
  if (typeof quote !== 'string') return false;
  if (n > 0 && n % 7 === 0) {
    const w = n / 7;
    const word = numberWord(w, 10);
    const forms = [String(w), ...(word ? [word] : [])];
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

/** A quote states an amount as a decimal or, for quarters and halves, as a
 *  label fraction ("½ pint", "1 1/2 pints"). */
export function statesAmount(quote: unknown, n: number): boolean {
  if (typeof quote !== 'string') return false;
  if (statesNumber(quote, n)) return true;
  const whole = Math.floor(n);
  const frac = fractionForms(Math.round((n - whole) * 100) / 100);
  if (!frac) return false;
  return frac.some((f) => {
    const forms = whole === 0 ? [f] : [`${whole} ${f}`, `${whole}${f}`];
    return forms.some((form) => {
      const esc = form.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      return new RegExp(`(^|[^0-9/])${esc}([^0-9/]|$)`).test(quote);
    });
  });
}

function fractionPatterns(n: number): string[] {
  const whole = Math.floor(n);
  const forms = fractionForms(n - whole);
  if (!forms) return [];
  return forms.map((f) => (whole === 0 ? f : `${whole}(?:[- ]|\\s)?${f}`));
}

/** The quote states the figure in inches (as a decimal or a fraction), in
 *  feet, or in feet as a word ("two feet between the rows"). */
export function statesInches(quote: string, inches: number): boolean {
  const figures = [numberPattern(inches), ...fractionPatterns(inches)];
  const feet = inches / 12;
  if (Number.isInteger(feet) || Number.isInteger(feet * 2)) {
    figures.push(numberPattern(feet), ...fractionPatterns(feet));
  }
  if (figures.some((f) => statesFigure(quote, f))) return true;
  const word = numberWord(feet, 12);
  if (word && new RegExp(`\\b${word}[- ](foot|feet)\\b`, 'i').test(quote)) return true;
  // #600: inches as a word ("six to twelve-inches apart").
  const inchWord = numberWord(inches, 12);
  return !!inchWord && /\binch/i.test(quote) && new RegExp(`\\b${inchWord}\\b`, 'i').test(quote);
}
