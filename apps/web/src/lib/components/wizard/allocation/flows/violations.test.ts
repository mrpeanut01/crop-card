import { describe, expect, it } from 'vitest';
import { humanizeAllocationViolation } from './violations';

const blocks = [{ id: 'block-north-0001', name: 'North Bed', plantings: [] }];
const seeds = [
  {
    stockItemId: 'stock-bean-0001',
    displayName: 'Bush Bean',
    onHand: 1,
    defaultUnit: 'seeds',
    cropPluginId: 'bean',
    cropFamily: 'legume'
  }
];

describe('Phase 35 violation prefixes (C-1)', () => {
  it('names the seed and the block with room', () => {
    expect(
      humanizeAllocationViolation(
        'unplaced-with-room: stock-bean-0001 placed 10/40 while block-north-0001 has room for 12',
        blocks,
        seeds
      )
    ).toBe('Bush Bean left plants out while North Bed still had room.');
  });

  it('explains a keep-in-one-bed seed on more than one block', () => {
    expect(
      humanizeAllocationViolation('kept-in-one-bed: stock-bean-0001 is on 2 blocks', blocks, seeds)
    ).toBe('Bush Bean is kept in one bed but was put in more than one.');
  });

  it('explains a keep-apart pair Claude put on one block', () => {
    expect(
      humanizeAllocationViolation(
        'keep-apart: stock-bean-0001 (bean) is on block-north-0001 with onion, which must be kept apart.',
        blocks,
        seeds
      )
    ).toBe('Bush Bean was put on North Bed next to a crop it should be kept apart from.');
  });

  it('explains split parts on ruled-out blocks', () => {
    expect(
      humanizeAllocationViolation(
        'split-ruled-out: stock-bean-0001 has parts on block-north-0001, b2',
        blocks,
        seeds
      )
    ).toBe(
      'More than one part of Bush Bean went where its crop rotation or a crop it would cross with rules it out.'
    );
  });
});
