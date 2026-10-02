import { t } from '$lib/i18n';
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
  prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS,
  locale?: string | null
): string {
  const [seedA, seedB] = c.pairDisplayNames;
  const [blockA, blockB] = c.blockNames;
  if (c.kind === 'geometry-missing' || c.distanceFt === null) {
    return t(locale, 'plan.poll.geometryMissing', { blockA, blockB });
  }
  const d = formatQuantity(c.distanceFt, 'distance', prefs);
  if (c.kind === 'isolated-spatially') {
    return t(locale, 'plan.poll.isolated', { seedA, blockA, d, seedB, blockB });
  }
  return t(locale, 'plan.poll.stagger', { seedA, blockA, seedB, blockB, d, days: c.staggerDays });
}
