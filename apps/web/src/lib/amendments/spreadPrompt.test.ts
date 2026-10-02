import { describe, expect, it } from 'vitest';
import { isSensitiveFamily, parseCarryoverAck, promptsFor, sensitiveTarget } from './spreadPrompt';

describe('sensitiveTarget (M-44)', () => {
  it('flags garden and greenhouse Areas whatever grows there', () => {
    expect(sensitiveTarget({ areaKind: 'garden', plantings: [] })).toEqual({
      sensitive: true,
      reasons: ['garden-area'],
      families: []
    });
    expect(sensitiveTarget({ areaKind: 'greenhouse', plantings: [] }).reasons).toEqual([
      'greenhouse-area'
    ]);
  });

  it('flags a planned or active crop the synthetic-auxin class damages', () => {
    const r = sensitiveTarget({
      areaKind: 'field',
      plantings: [
        { status: 'planned', family: 'solanaceae' },
        { status: 'active', family: 'legume' },
        { status: 'active', family: 'forage' }
      ]
    });
    expect(r).toEqual({
      sensitive: true,
      reasons: ['sensitive-crop'],
      families: ['legume', 'solanaceae']
    });
  });

  it('does not flag a grass hay field, and ignores harvested crops', () => {
    expect(
      sensitiveTarget({
        areaKind: 'field',
        plantings: [
          { status: 'active', family: 'forage' },
          { status: 'harvested', family: 'solanaceae' }
        ]
      }).sensitive
    ).toBe(false);
  });

  it('errs toward warning on a crop with no known family, with no 12 month window', () => {
    const r = sensitiveTarget({ areaKind: null, plantings: [{ status: 'planned', family: null }] });
    expect(r.reasons).toEqual(['unknown-family']);
    expect(isSensitiveFamily(null)).toBe(true);
    expect(isSensitiveFamily('cereal-grain')).toBe(false);
  });

  it('prompts only for may-carry and not-known', () => {
    expect(promptsFor('may-carry')).toBe(true);
    expect(promptsFor('not-known')).toBe(true);
    expect(promptsFor('none-on-file')).toBe(false);
  });

  it('parses a stored ack and refuses junk', () => {
    expect(parseCarryoverAck(null)).toBeNull();
    expect(parseCarryoverAck('not json')).toBeNull();
    expect(parseCarryoverAck('{"v":2}')).toBeNull();
    expect(parseCarryoverAck('{"v":1,"batchId":"b"}')?.batchId).toBe('b');
  });
});
