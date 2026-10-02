import { describe, expect, it } from 'vitest';
import { forageAccess } from './access';

describe('forageAccess (M-60)', () => {
  it('lets owners do everything, helpers and operators record, inspectors read', () => {
    expect(forageAccess('owner')).toEqual({ canRecord: true, canAttach: true, canDelete: true });
    for (const role of ['helper', 'custom-operator']) {
      expect(forageAccess(role)).toEqual({ canRecord: true, canAttach: false, canDelete: false });
    }
    expect(forageAccess('inspector').canRecord).toBe(false);
    expect(forageAccess(null).canRecord).toBe(false);
  });
});
