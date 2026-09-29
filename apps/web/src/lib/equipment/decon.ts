/**
 * One rule for "this sprayer still holds its last load": it carried
 * chemistry and has not been deconned since it was last used. The layout
 * banner, the /today alert card, Settings and the offline equipment Card
 * all read it, so they never disagree.
 */
export interface DeconStateLike {
  lastChemistryClass?: string | null;
  /** When the sprayer last carried a load. */
  lastUsedAt?: number | null;
  lastDeconAt?: number | null;
}

export function needsDecon(s: DeconStateLike | null | undefined): boolean {
  if (!s?.lastChemistryClass || !s.lastUsedAt) return false;
  return !(s.lastDeconAt && s.lastDeconAt >= s.lastUsedAt);
}

/** /today shows its own per-sprayer cleanout card (#470), so the layout's
 *  banner stays off there and a dirty sprayer is reported once per screen. */
export function showLayoutDeconBanner(pathname: string, dirtySprayers: number): boolean {
  return dirtySprayers > 0 && pathname !== '/today';
}
