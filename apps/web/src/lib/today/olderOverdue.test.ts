import { describe, expect, it } from 'vitest';
import { withOlderOverdue } from './olderOverdue';

const DAY = 86_400_000;
const FROM = Date.parse('2027-03-20T00:00:00Z');

describe('withOlderOverdue (#742)', () => {
  it('adds open tasks due before the window, oldest first, without duplicates', () => {
    const inWindow = [{ id: 'w', scheduledFor: FROM + 2 * DAY }];
    const open = [
      { id: 'w', scheduledFor: FROM + 2 * DAY },
      { id: 'b', scheduledFor: FROM - 9 * DAY },
      { id: 'a', scheduledFor: FROM - 400 * DAY }
    ];
    expect(withOlderOverdue(inWindow, open, FROM).map((t) => t.id)).toEqual(['a', 'b', 'w']);
  });

  it('leaves the window alone when nothing older is open', () => {
    const inWindow = [{ id: 'w', scheduledFor: FROM }];
    expect(withOlderOverdue(inWindow, inWindow, FROM)).toEqual(inWindow);
  });
});
