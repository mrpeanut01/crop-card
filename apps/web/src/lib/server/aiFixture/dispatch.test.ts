// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_ENTRIES,
  FixtureNoAnswerError,
  allocationFixture,
  dispatchFixture,
  fixtureAnswerText,
  fixtureMessage
} from './claude';
import { GARDEN_BRIEF_FIXTURE_MARKER, gardenBriefFixture } from './gardenBrief';
import { PHOTO_MARKS_FIXTURE_MARKER, photoMarksFixture } from './photoMarks';
import type { CreateParams, FixtureEntry, FixtureMessage } from './types';

const ask = (text: string, system?: string): CreateParams => ({
  model: 'm',
  ...(system ? { system } : {}),
  messages: [{ role: 'user', content: text }]
});

describe('fixture dispatch table', () => {
  it('lists allocation, garden brief and photo marks once each', () => {
    expect(FIXTURE_ENTRIES.map((e) => e.name)).toEqual([
      'allocation',
      'garden-brief',
      'photo-marks'
    ]);
    expect(FIXTURE_ENTRIES).toContain(gardenBriefFixture);
    expect(FIXTURE_ENTRIES).toContain(photoMarksFixture);
  });

  it('routes a prompt by its marker, in the turns or the system text', () => {
    expect(gardenBriefFixture.matches(ask(`hello ${GARDEN_BRIEF_FIXTURE_MARKER}`))).toBe(true);
    expect(gardenBriefFixture.matches(ask('hello', GARDEN_BRIEF_FIXTURE_MARKER))).toBe(true);
    expect(photoMarksFixture.matches(ask(GARDEN_BRIEF_FIXTURE_MARKER))).toBe(false);
    expect(photoMarksFixture.matches(ask(`x ${PHOTO_MARKS_FIXTURE_MARKER}`))).toBe(true);
    expect(allocationFixture.matches(ask(GARDEN_BRIEF_FIXTURE_MARKER))).toBe(false);
  });

  it('answers through the matching module, which throws until a cluster fills it', () => {
    expect(() => fixtureAnswerText(ask(GARDEN_BRIEF_FIXTURE_MARKER))).toThrow(FixtureNoAnswerError);
    expect(
      JSON.parse(fixtureMessage(ask(PHOTO_MARKS_FIXTURE_MARKER)).content[0].text).marks
    ).toHaveLength(3);
    expect(() => fixtureAnswerText(ask('no marker here'))).toThrow(FixtureNoAnswerError);
  });

  it('takes the first matching entry and passes a whole message through as is', () => {
    const whole: FixtureMessage = {
      id: 'msg_probe',
      type: 'message',
      role: 'assistant',
      model: 'm',
      content: [
        { type: 'text', text: 'part one ', citations: null },
        { type: 'text', text: 'two', citations: null }
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      }
    };
    const first: FixtureEntry = { name: 'first', matches: () => true, answer: () => whole };
    const second: FixtureEntry = { name: 'second', matches: () => true, answer: () => 'never' };
    const table = [first, second];
    expect(dispatchFixture(ask('x'), table)).toBe(whole);
    expect(fixtureMessage(ask('x'), table)).toBe(whole);
    expect(fixtureAnswerText(ask('x'), table)).toBe('part one two');

    const text: FixtureEntry = { name: 'text', matches: () => true, answer: () => 'plain' };
    const msg = fixtureMessage(ask('x'), [text]);
    expect(msg.content).toEqual([{ type: 'text', text: 'plain', citations: null }]);
    expect(fixtureAnswerText(ask('x'), [text])).toBe('plain');
    expect(() => dispatchFixture(ask('x'), [])).toThrow(FixtureNoAnswerError);
  });
});
