/**
 * F3-4, shared by the printed Week and Month Cards and the Monday summary so
 * paper, email and screen agree on which tasks are spray work and which
 * titles may not be printed as typed.
 */

/** A number followed by a rate unit, or a per-area rate. No printed Week or
 *  Month Card may match this (F3-4). */
export const PRINTED_RATE_PATTERN =
  /\d[\d.,/]*\s*(?:fl\.?\s*oz|oz|ounces?|qts?|quarts?|pts?|pints?|gal|gallons?|lbs?|pounds?|ml|l|liters?|litres?|g|kg|tbsp|tsp|cups?)\b|\bper\s+(?:acre|ac|a|1,?000\s*(?:sq\.?\s*ft|square\s+feet))\b|\/\s*(?:acre|ac|a|1,?000\s*(?:sq\.?\s*ft|square\s+feet))\b/i;

/** Mixing directions: a tank or jug step, or a numbered mix order. */
export const PRINTED_MIX_PATTERN =
  /\bmix(?:ing)?\s+order\b|\btank\s*-?\s*mix\b|\b(?:fill|add|pour|agitate|mix|stir)\b[^.;]*\b(?:tank|jug|sprayer|water|concentrate)\b|\bstep\s+\d/i;

export const SPRAY_TASK_WORDS =
  /\b(?:spray(?:ing|ed)?|herbicide|insecticide|fungicide|pesticide|burn\s*down|(?:pre|post)[\s-]*emergent)\b/i;

export const SPRAY_EVENT_TABLES: ReadonlySet<string> = new Set([
  'spray_event',
  'insecticide_event',
  'fungicide_event'
]);

export const TASK_DETAILS_TEXT = 'Task, details on the Task Card';
export const TASK_DETAILS_HINT = 'See the Task Card';

/** Spray, insecticide or fungicide work, by category, the record it will
 *  become, or its title. */
export function isSprayTaskLike(t: {
  category?: string | null;
  relatedEventTable?: string | null;
  title?: string | null;
}): boolean {
  return (
    t.category === 'spray' ||
    SPRAY_EVENT_TABLES.has(t.relatedEventTable ?? '') ||
    SPRAY_TASK_WORDS.test(t.title ?? '')
  );
}

/** A rate or a mixing step that must not be printed as typed. */
export function unsafeOnPaper(text: string): boolean {
  return PRINTED_RATE_PATTERN.test(text) || PRINTED_MIX_PATTERN.test(text);
}
