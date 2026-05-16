import { describe, expect, it } from 'vitest';
import type { CompanionPlugin, CropPlugin } from '$lib/plugins/schemas';
import {
  anchorStockInGroup,
  detectCompanionGroups,
  offsetForStockInGroup
} from './companionOffsets';

const threeSisters: CompanionPlugin = {
  pluginId: 'three-sisters',
  type: 'companion',
  schemaVersion: '1.0.0',
  displayName: 'Three Sisters',
  primaryFamily: 'corn',
  goodWith: ['corn', 'beans', 'squash'],
  badWith: [],
  members: [
    { family: 'legume', role: 'trellis + n-fixer', plantingOffsetDays: 14 },
    { family: 'cucurbit', role: 'ground-cover', plantingOffsetDays: 35 }
  ]
} as unknown as CompanionPlugin;

function plug(id: string, family: string): CropPlugin {
  return {
    pluginId: id,
    type: 'crop',
    schemaVersion: '1.0.0',
    displayName: id,
    cropFamily: family
  } as unknown as CropPlugin;
}

describe('detectCompanionGroups', () => {
  const pluginIndex = {
    'corn-bantam': plug('corn-bantam', 'corn'),
    'bean-pole': plug('bean-pole', 'legume'),
    'squash-acorn': plug('squash-acorn', 'cucurbit'),
    'corn-bloody': plug('corn-bloody', 'corn'),
    'kale-lacinato': plug('kale-lacinato', 'brassica')
  };

  it('detects a 3-sisters trio on one block', () => {
    const groups = detectCompanionGroups(
      [
        { stockItemId: 's-corn', blockId: 'b1', cropPluginId: 'corn-bantam' },
        { stockItemId: 's-bean', blockId: 'b1', cropPluginId: 'bean-pole' },
        { stockItemId: 's-squash', blockId: 'b1', cropPluginId: 'squash-acorn' }
      ],
      pluginIndex,
      [threeSisters]
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].anchorFamily).toBe('corn');
    expect(groups[0].members.find((m) => m.role === 'anchor')?.stockItemId).toBe('s-corn');
    expect(groups[0].members.find((m) => m.stockItemId === 's-bean')?.daysFromAnchor).toBe(14);
    expect(groups[0].members.find((m) => m.stockItemId === 's-squash')?.daysFromAnchor).toBe(35);
  });

  it('skips when one member family is missing on the block', () => {
    const groups = detectCompanionGroups(
      [
        { stockItemId: 's-corn', blockId: 'b1', cropPluginId: 'corn-bantam' },
        { stockItemId: 's-bean', blockId: 'b1', cropPluginId: 'bean-pole' }
        // No squash on b1 → not a 3-sisters group
      ],
      pluginIndex,
      [threeSisters]
    );
    expect(groups).toEqual([]);
  });

  it('produces one group per anchor block (not per block, not per assignment)', () => {
    const groups = detectCompanionGroups(
      [
        { stockItemId: 's-corn-1', blockId: 'b1', cropPluginId: 'corn-bantam' },
        { stockItemId: 's-bean-1', blockId: 'b1', cropPluginId: 'bean-pole' },
        { stockItemId: 's-squash-1', blockId: 'b1', cropPluginId: 'squash-acorn' },
        { stockItemId: 's-corn-2', blockId: 'b2', cropPluginId: 'corn-bloody' },
        { stockItemId: 's-bean-2', blockId: 'b2', cropPluginId: 'bean-pole' },
        { stockItemId: 's-squash-2', blockId: 'b2', cropPluginId: 'squash-acorn' }
      ],
      pluginIndex,
      [threeSisters]
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.groupId).sort()).toEqual(['b1:s-corn-1', 'b2:s-corn-2']);
  });
});

describe('offsetForStockInGroup + anchorStockInGroup', () => {
  const group = {
    groupId: 'b1:s-corn',
    anchorFamily: 'corn',
    members: [
      { stockItemId: 's-corn', role: 'anchor' as const, daysFromAnchor: 0 },
      { stockItemId: 's-bean', role: 'companion' as const, daysFromAnchor: 14 },
      { stockItemId: 's-squash', role: 'companion' as const, daysFromAnchor: 35 }
    ]
  };
  it('returns the offset for a member', () => {
    expect(offsetForStockInGroup(group, 's-bean')).toBe(14);
    expect(offsetForStockInGroup(group, 's-squash')).toBe(35);
    expect(offsetForStockInGroup(group, 's-corn')).toBe(0);
  });
  it('returns null for non-members', () => {
    expect(offsetForStockInGroup(group, 's-something-else')).toBeNull();
  });
  it('finds the anchor', () => {
    expect(anchorStockInGroup(group)).toBe('s-corn');
  });
});
