/** TEST ONLY. Fixture Claude answers for the photo marks (Phase 37, R-24).
 *  A request is routed here when its prompt carries `PHOTO_MARKS_FIXTURE_MARKER`.
 *  The words are placeholders and hold no growing advice. */
import { type FixtureEntry, promptHasMarker } from './types';

export const PHOTO_MARKS_FIXTURE_MARKER = 'CROPCARD_FIXTURE:photo-marks';

export const PHOTO_MARKS_FIXTURE_ANSWER = {
  steps: ['Placeholder step one.', 'Placeholder step two.', 'Placeholder step three.'],
  marks: [
    { kind: 'cut', x: 0.3, y: 0.25, label: 'Mark one' },
    { kind: 'pinch', x: 0.7, y: 0.4, label: 'Mark two' },
    { kind: 'harvest', x: 0.2, y: 0.6, w: 0.3, h: 0.25, label: 'Mark three' }
  ]
} as const;

export const photoMarksFixture: FixtureEntry = {
  name: 'photo-marks',
  matches: (params) => promptHasMarker(params, PHOTO_MARKS_FIXTURE_MARKER),
  answer: () => JSON.stringify(PHOTO_MARKS_FIXTURE_ANSWER)
};
