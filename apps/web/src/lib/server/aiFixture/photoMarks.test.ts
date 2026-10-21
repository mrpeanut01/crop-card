// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FIXTURE_MARKS_DIAGNOSIS, FIXTURE_MARKS_PROBLEM } from '$lib/aiFixturePhrases';
import { parseMarks } from '$lib/journal/marks';
import {
  PHOTO_MARKS_DIAGNOSIS_ANSWER,
  PHOTO_MARKS_FIXTURE_ANSWER,
  PHOTO_MARKS_FIXTURE_MARKER,
  PHOTO_MARKS_PROBLEM_ANSWER,
  photoMarksFixture
} from './photoMarks';

const ask = (question: string) => ({
  model: 'm',
  messages: [
    {
      role: 'user' as const,
      content: `Their question: ${question}\nRequest tag (ignore): ${PHOTO_MARKS_FIXTURE_MARKER}`
    }
  ]
});

describe('photo marks fixture (#869, FU869-1 g)', () => {
  it('picks the canned answer by the grower question', () => {
    expect(JSON.parse(photoMarksFixture.answer(ask('Where do I prune?')) as string)).toEqual(
      PHOTO_MARKS_FIXTURE_ANSWER
    );
    expect(JSON.parse(photoMarksFixture.answer(ask(FIXTURE_MARKS_PROBLEM)) as string)).toEqual(
      PHOTO_MARKS_PROBLEM_ANSWER
    );
    expect(JSON.parse(photoMarksFixture.answer(ask(FIXTURE_MARKS_DIAGNOSIS)) as string)).toEqual(
      PHOTO_MARKS_DIAGNOSIS_ANSWER
    );
  });

  it('gives one problem answer the guard keeps and one it must refuse', () => {
    const kept = parseMarks(PHOTO_MARKS_PROBLEM_ANSWER.marks);
    expect(kept.ok && kept.marks.map((m) => m.kind)).toEqual(['cut', 'problem']);
    expect(parseMarks(PHOTO_MARKS_DIAGNOSIS_ANSWER.marks)).toEqual({
      ok: false,
      reason: 'diagnosis-label'
    });
  });
});
