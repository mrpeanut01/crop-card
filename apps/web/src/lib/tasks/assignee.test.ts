import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { defaultAssigneeWho, memberName, resolveAssigneeWho } from './assignee';

describe('memberName (F0-12)', () => {
  it('prefers the chosen name, then the email local-part, then the phone’s last four', () => {
    expect(memberName({ displayName: ' Maria ', email: 'm@x.test', phone: null })).toBe('Maria');
    expect(memberName({ email: 'jo.smith@farm.test', phone: '+15405550000' })).toBe('jo.smith');
    expect(memberName({ email: null, phone: '+15405559876' })).toBe('phone ending 9876');
    expect(memberName({ email: null, phone: null })).toBe('Farm member');
    expect(memberName({ displayName: '   ', email: null, phone: null })).toBe('Farm member');
  });

  it('never prints a full email address or phone number', () => {
    fc.assert(
      fc.property(
        fc.option(fc.emailAddress(), { nil: null }),
        fc.option(fc.stringMatching(/^\+1[0-9]{10}$/), { nil: null }),
        (email, phone) => {
          const name = memberName({ email, phone });
          expect(name).not.toContain('@');
          if (phone) expect(name).not.toContain(phone.slice(1, 8));
        }
      )
    );
  });
});

describe('defaultAssigneeWho (F1-8)', () => {
  const mine = [{ assigneeUserId: 'u1' }, { assigneeUserId: null }];
  it('starts helpers and custom operators on Mine when something is theirs', () => {
    expect(defaultAssigneeWho('helper', 'u1', mine)).toBe('mine');
    expect(defaultAssigneeWho('custom-operator', 'u1', mine)).toBe('mine');
    expect(defaultAssigneeWho('helper', 'u2', mine)).toBe('all');
    expect(defaultAssigneeWho('helper', 'u1', [])).toBe('all');
  });
  it('owners and inspectors start on Everyone', () => {
    expect(defaultAssigneeWho('owner', 'u1', mine)).toBe('all');
    expect(defaultAssigneeWho('inspector', 'u1', mine)).toBe('all');
    expect(defaultAssigneeWho(undefined, undefined, mine)).toBe('all');
  });
  it('the URL wins when it names a known value', () => {
    expect(resolveAssigneeWho('mine', 'all')).toBe('mine');
    expect(resolveAssigneeWho('all', 'mine')).toBe('all');
    expect(resolveAssigneeWho('bogus', 'mine')).toBe('mine');
    expect(resolveAssigneeWho(null, 'all')).toBe('all');
  });
});
