/** TEST ONLY. Fixture Claude answers for the photo marks (Phase 37, R-24).
 *  A request is routed here when its prompt carries `PHOTO_MARKS_FIXTURE_MARKER`. */
import { type FixtureEntry, FixtureNoAnswerError, promptHasMarker } from './types';

export const PHOTO_MARKS_FIXTURE_MARKER = 'CROPCARD_FIXTURE:photo-marks';

export const photoMarksFixture: FixtureEntry = {
  name: 'photo-marks',
  matches: (params) => promptHasMarker(params, PHOTO_MARKS_FIXTURE_MARKER),
  answer() {
    throw new FixtureNoAnswerError('photo marks request');
  }
};
