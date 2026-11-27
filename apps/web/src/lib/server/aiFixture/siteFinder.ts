/** TEST ONLY. Fixture Claude answer for Find a spot (Phase 38D). A request is
 *  routed here when its prompt carries `SITE_FINDER_FIXTURE_MARKER`. The
 *  positions are placeholders over the recorded Loudoun photo and the words
 *  hold no growing advice. */
import { type FixtureEntry, promptHasMarker } from './types';

export const SITE_FINDER_FIXTURE_MARKER = 'CROPCARD_FIXTURE:site-finder';

export const SITE_FINDER_FIXTURE_ANSWER = {
  features: [
    { kind: 'tree', x: 0.2, y: 0.2, radius: 0.08, note: 'Placeholder tree note' },
    { kind: 'building', x: 0.85, y: 0.85, radius: 0.05, note: 'Placeholder building note' },
    { kind: 'tree-line', x: 0.05, y: 0.6, x2: 0.05, y2: 0.95 },
    { kind: 'open-lawn', x: 0.6, y: 0.45, radius: 0.15, note: 'Placeholder open ground note' }
  ],
  spots: [{ x: 0.6, y: 0.45, reason: 'Placeholder reason for this place.' }],
  caveats: 'Placeholder caveat.'
} as const;

export const siteFinderFixture: FixtureEntry = {
  name: 'site-finder',
  matches: (params) => promptHasMarker(params, SITE_FINDER_FIXTURE_MARKER),
  answer: () => JSON.stringify(SITE_FINDER_FIXTURE_ANSWER)
};
