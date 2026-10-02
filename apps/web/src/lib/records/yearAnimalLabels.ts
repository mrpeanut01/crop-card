import type { MessageKey } from '$lib/i18n';
import type { CoveredDeclarationLine } from './yearSummaryAnimals';

export const YEAR_MOVE_KEY: Record<string, MessageKey> = {
  arrived: 'recui.year.move.arrived',
  sold: 'recui.year.move.sold',
  'sold-for-meat': 'recui.year.move.soldForMeat',
  slaughtered: 'recui.year.move.slaughtered',
  died: 'recui.year.move.died',
  culled: 'recui.year.move.culled',
  rehomed: 'recui.year.move.rehomed'
};

export const YEAR_USE_KEY: Record<string, MessageKey> = {
  food: 'recui.year.use.food',
  sale: 'recui.year.use.sale',
  discard: 'recui.year.use.discard',
  'feed-to-animals': 'recui.year.use.feed',
  unknown: 'recui.year.use.unknown'
};

/** Catalog key for a covered row's use: a production use for eggs and
 *  milk, the status change for meat. Null falls back to the English label. */
export function coveredUseKey(
  c: Pick<CoveredDeclarationLine, 'what' | 'useCode'>
): MessageKey | null {
  const table = c.what === 'meat' ? YEAR_MOVE_KEY : YEAR_USE_KEY;
  return table[c.useCode] ?? null;
}
