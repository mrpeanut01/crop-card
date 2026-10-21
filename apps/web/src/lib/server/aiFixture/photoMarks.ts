/** TEST ONLY. Fixture Claude answers for the photo marks (Phase 37, R-24).
 *  A request is routed here when its prompt carries `PHOTO_MARKS_FIXTURE_MARKER`.
 *  The grower's question picks the answer (#869): a problem mark beside a cut
 *  mark, or a problem label that names a disease, which the server must
 *  refuse with the whole set. The words are placeholders and hold no growing
 *  advice; the disease name is there only to be refused. */
import { FIXTURE_MARKS_DIAGNOSIS, FIXTURE_MARKS_PROBLEM } from '$lib/aiFixturePhrases';
import { type FixtureEntry, promptHasMarker, promptText } from './types';

export const PHOTO_MARKS_FIXTURE_MARKER = 'CROPCARD_FIXTURE:photo-marks';

export const PHOTO_MARKS_FIXTURE_ANSWER = {
  steps: ['Placeholder step one.', 'Placeholder step two.', 'Placeholder step three.'],
  marks: [
    { kind: 'cut', x: 0.3, y: 0.25, label: 'Mark one' },
    { kind: 'pinch', x: 0.7, y: 0.4, label: 'Mark two' },
    { kind: 'harvest', x: 0.2, y: 0.6, w: 0.3, h: 0.25, label: 'Mark three' }
  ]
} as const;

export const PHOTO_MARKS_PROBLEM_ANSWER = {
  steps: ['Placeholder step one.', 'Placeholder problem step.'],
  marks: [
    { kind: 'cut', x: 0.3, y: 0.25, label: 'Mark one' },
    { kind: 'problem', x: 0.6, y: 0.55, w: 0.2, h: 0.2, label: 'Yellow lower leaves' }
  ]
} as const;

export const PHOTO_MARKS_DIAGNOSIS_ANSWER = {
  steps: ['Placeholder step one.', 'Placeholder problem step.'],
  marks: [
    { kind: 'cut', x: 0.3, y: 0.25, label: 'Mark one' },
    { kind: 'problem', x: 0.6, y: 0.55, label: 'Powdery mildew here' }
  ]
} as const;

/** The canned answer for a marks prompt, picked by the grower's question. */
export function photoMarksAnswerFor(prompt: string): object {
  if (prompt.includes(FIXTURE_MARKS_DIAGNOSIS)) return PHOTO_MARKS_DIAGNOSIS_ANSWER;
  if (prompt.includes(FIXTURE_MARKS_PROBLEM)) return PHOTO_MARKS_PROBLEM_ANSWER;
  return PHOTO_MARKS_FIXTURE_ANSWER;
}

export const photoMarksFixture: FixtureEntry = {
  name: 'photo-marks',
  matches: (params) => promptHasMarker(params, PHOTO_MARKS_FIXTURE_MARKER),
  answer: (params) => JSON.stringify(photoMarksAnswerFor(promptText(params)))
};
