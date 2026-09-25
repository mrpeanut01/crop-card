import { DEFAULT_PREFS, formatQuantity, type Prefs } from '$lib/prefs';
import type { PollinationConstraint } from './types';

/** The plain-English sentence for a constraint, with the distance in the
 *  user's units. The server builds it with US defaults; the wizard
 *  re-renders it from the structured fields for metric users. */
export function pollinationNote(
  c: Pick<
    PollinationConstraint,
    'kind' | 'pairDisplayNames' | 'blockNames' | 'distanceFt' | 'staggerDays'
  >,
  prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS
): string {
  const [seedA, seedB] = c.pairDisplayNames;
  const [blockA, blockB] = c.blockNames;
  if (c.kind === 'geometry-missing' || c.distanceFt === null) {
    return `Couldn't check isolation between ${blockA} and ${blockB} — add geometry to one or both to enable the check.`;
  }
  const d = formatQuantity(c.distanceFt, 'distance', prefs);
  if (c.kind === 'isolated-spatially') {
    return `${seedA} on ${blockA} is ${d} from ${seedB} on ${blockB} — far enough apart that cross-pollination isn't an issue.`;
  }
  return `${seedA} (${blockA}) and ${seedB} (${blockB}) are only ${d} apart — schedule plantings ≥${c.staggerDays} d apart so their flowering windows don't overlap.`;
}
