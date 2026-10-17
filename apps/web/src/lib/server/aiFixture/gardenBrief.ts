/** TEST ONLY. Fixture Claude answers for the garden brief (Phase 37, R-24).
 *  A request is routed here when its prompt carries `GARDEN_BRIEF_FIXTURE_MARKER`. */
import { type FixtureEntry, FixtureNoAnswerError, promptHasMarker } from './types';

export const GARDEN_BRIEF_FIXTURE_MARKER = 'CROPCARD_FIXTURE:garden-brief';

export const gardenBriefFixture: FixtureEntry = {
  name: 'garden-brief',
  matches: (params) => promptHasMarker(params, GARDEN_BRIEF_FIXTURE_MARKER),
  answer() {
    throw new FixtureNoAnswerError('garden brief request');
  }
};
