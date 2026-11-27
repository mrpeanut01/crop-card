/** The kinds of Area the soil survey is shown for: ground a crop grows in.
 *  A greenhouse grows in its own mix, and barns, houses, water and
 *  boundaries grow nothing. */
export const SOIL_SURVEY_AREA_KINDS = ['field', 'garden', 'orchard', 'pasture'] as const;

export function showsSoilSurvey(kind: string | null | undefined): boolean {
  return (SOIL_SURVEY_AREA_KINDS as readonly string[]).includes(kind ?? '');
}
