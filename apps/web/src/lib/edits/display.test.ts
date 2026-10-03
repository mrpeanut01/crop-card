import { describe, expect, it } from 'vitest';
import { editFieldLabel, formatEditValue } from './display';

const ctx = { day: (ms: number) => new Date(ms).toISOString().slice(0, 10) };

describe('formatEditValue (U-06)', () => {
  it('reads values in plain words', () => {
    expect(formatEditValue('plantingDate', Date.UTC(2026, 4, 2), ctx)).toBe('2026-05-02');
    expect(formatEditValue('blockId', 'blk_1', { ...ctx, blockNames: { blk_1: 'Bed 1' } })).toBe(
      'Bed 1'
    );
    expect(formatEditValue('blockId', 'blk_9', ctx)).toBe('blk_9');
    expect(formatEditValue('quantityPlanted', null, ctx)).toBe('Not set');
    expect(formatEditValue('harvestUseCases', null, ctx)).toBe('All of them');
    expect(formatEditValue('harvestUseCases', [], ctx)).toBe('None');
    expect(
      formatEditValue('harvestUseCases', ['fresh-eating', 'sauce'], {
        ...ctx,
        useLabels: { sauce: 'Sauce' }
      })
    ).toBe('Fresh eating, Sauce');
    expect(formatEditValue('assigneeUserId', 'u1', ctx)).toBe('Someone else');
    expect(formatEditValue('assigneeUserId', 'u1', { ...ctx, people: { u1: 'Ana' } })).toBe('Ana');
  });

  it('follows the locale for labels and crop names', () => {
    expect(editFieldLabel('quantityPlanted')).toBe('Amount planted');
    expect(editFieldLabel('quantityPlanted', 'es')).toBe('Cantidad sembrada');
    expect(formatEditValue('quantityPlanted', null, { ...ctx, locale: 'es' })).toBe('Sin valor');
  });
});
