import { describe, expect, it } from 'vitest';
import { organicInputNotice, organicNoticeMessage } from './organicInputNotice';

const LINE = 'Transitioning (owner-entered, effective Apr 1, 2025, certifier OCIA)';
const organicBlocks = { b1: LINE, b2: 'Organic (owner-entered, effective Jan 1, 2024)' };
const blockNames = { b1: 'North bed', b2: 'South bed', b3: 'Barn bed' };

describe('organicInputNotice (B-20)', () => {
  it('says nothing when no selected block has a status', () => {
    expect(
      organicInputNotice({
        organicBlocks,
        selectedBlockIds: ['b3'],
        products: [{ name: 'Urea', inputClass: 'not-allowed' }]
      })
    ).toBeNull();
  });

  it('says nothing when the page sends no statuses (chrome not full)', () => {
    for (const ob of [null, undefined, {}]) {
      expect(
        organicInputNotice({
          organicBlocks: ob,
          selectedBlockIds: ['b1'],
          products: [{ name: 'Urea', inputClass: 'not-allowed' }]
        })
      ).toBeNull();
    }
  });

  it('says nothing when every product is marked allowed', () => {
    expect(
      organicInputNotice({
        organicBlocks,
        selectedBlockIds: ['b1'],
        products: [{ name: 'Biochar', inputClass: 'allowed' }]
      })
    ).toBeNull();
  });

  it('names each product and each block with its status line', () => {
    const n = organicInputNotice({
      organicBlocks,
      selectedBlockIds: ['b1', 'b3'],
      products: [
        { name: 'Biochar', inputClass: 'allowed' },
        { name: 'K-Mag', inputClass: 'not-allowed' },
        { name: 'Neighbor compost', inputClass: 'not-marked' }
      ],
      blockNames
    })!;
    expect(n.products).toEqual([
      {
        name: 'K-Mag',
        inputClass: 'not-allowed',
        message:
          "The library marks this product as not allowed for organic use. It will show on this block's organic record."
      },
      {
        name: 'Neighbor compost',
        inputClass: 'not-marked',
        message:
          "This product isn't marked as allowed for organic use. It will show on this block's organic record."
      }
    ]);
    expect(n.blocks).toEqual([{ id: 'b1', name: 'North bed', statusLine: LINE }]);
  });

  it('speaks of several blocks when several are selected', () => {
    const n = organicInputNotice({
      organicBlocks,
      selectedBlockIds: ['b1', 'b2', 'b1'],
      products: [
        { name: 'Urea', inputClass: 'not-allowed' },
        { name: 'Urea', inputClass: 'not-allowed' }
      ]
    })!;
    expect(n.products).toHaveLength(1);
    expect(n.products[0].message).toContain("these blocks' organic records");
    expect(n.blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('never claims certification or uses an em dash', () => {
    for (const cls of ['not-allowed', 'not-marked'] as const) {
      for (const count of [1, 3]) {
        const m = organicNoticeMessage(cls, count);
        expect(m).not.toMatch(/—|certif|compliant|eligible|safe/i);
      }
    }
  });
});
