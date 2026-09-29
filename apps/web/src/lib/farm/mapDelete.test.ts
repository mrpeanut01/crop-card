import { describe, expect, it, vi } from 'vitest';
import {
  areaShape,
  blockShape,
  confirmTitle,
  deleteButtonLabel,
  deleteHint,
  deleteShapes,
  describeDeletion,
  featureShape,
  isSelected,
  outlineWarning,
  shadeShape,
  toggleShape
} from './mapDelete';

const garden = areaShape({ id: 'a1', name: 'Kitchen garden', kind: 'garden' });
const bed = blockShape({ id: 'b1', name: 'Bed 1' });
const oak = shadeShape({ id: 's1', name: 'Oak row' });
const fence = featureShape({ id: 'f1', name: 'East fence', kind: 'fence' });

describe('map delete (#476)', () => {
  it('toggles shapes in and out of the selection by type and id', () => {
    let sel = toggleShape([], garden);
    sel = toggleShape(sel, fence);
    expect(isSelected(sel, 'area', 'a1')).toBe(true);
    expect(isSelected(sel, 'block', 'a1')).toBe(false);
    sel = toggleShape(sel, garden);
    expect(sel).toEqual([fence]);
  });

  it('counts on the button and titles the confirm', () => {
    expect(deleteButtonLabel(1)).toBe('Delete 1 shape');
    expect(deleteButtonLabel(3)).toBe('Delete 3 shapes');
    expect(confirmTitle([fence])).toBe('Delete East fence?');
    expect(confirmTitle([fence, oak])).toBe('Delete 2 shapes?');
  });

  it('says an Area or block keeps its records and only loses the outline', () => {
    expect(describeDeletion(garden)).toBe(
      'The outline of Kitchen garden (garden) comes off the map. The Area and its records stay.'
    );
    expect(describeDeletion(bed)).toMatch(/block and its records stay/);
    expect(describeDeletion(oak)).toBe('Oak row (shade source) is deleted.');
    expect(describeDeletion(fence)).toBe('East fence (fence) is deleted.');
    expect(outlineWarning([fence])).toBeNull();
    expect(outlineWarning([fence, bed])).toMatch(/grazing/);
  });

  it('words the help for the device', () => {
    expect(deleteHint(false)).toBe('Right-click a shape to delete it.');
    expect(deleteHint(true)).toBe('Long-press a shape to delete it.');
  });

  it('removes outlines with null and deletes shade and features, reporting failures', async () => {
    const area = vi.fn();
    const block = vi.fn();
    const shade = vi.fn();
    const feature = vi.fn().mockRejectedValue(new Error('HTTP 500'));
    const out = await deleteShapes([garden, bed, oak, fence], { area, block, shade, feature });
    expect(area).toHaveBeenCalledWith('a1');
    expect(block).toHaveBeenCalledWith('b1');
    expect(shade).toHaveBeenCalledWith('s1');
    expect(out.deleted).toEqual([garden, bed, oak]);
    expect(out.failed).toEqual([{ shape: fence, message: 'HTTP 500' }]);
    const none = await deleteShapes([oak], { area, block });
    expect(none.failed[0].shape).toBe(oak);
  });
});
