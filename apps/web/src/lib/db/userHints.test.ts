import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { userHints, users } from './schema';
import { listSeen, markSeen } from './userHints';
import { MAX_HINTS_PER_USER } from '$lib/hints';

function seedUser(): string {
  const id = `hints-${randomUUID()}`;
  db.insert(users)
    .values({ id, email: `${id}@hints.test` })
    .run();
  return id;
}

describe('userHints repo', () => {
  it('starts empty and records a hint', () => {
    const u = seedUser();
    expect(listSeen(u)).toEqual([]);
    expect(markSeen(u, 'map_add', new Date(1_000))).toBe(true);
    expect(listSeen(u)).toEqual([{ key: 'map_add', seenAt: 1_000 }]);
  });

  it('is idempotent and keeps the first seenAt', () => {
    const u = seedUser();
    markSeen(u, 'garden_designer', new Date(1_000));
    markSeen(u, 'garden_designer', new Date(9_000));
    expect(listSeen(u)).toEqual([{ key: 'garden_designer', seenAt: 1_000 }]);
  });

  it('is per user, not per farm', () => {
    const a = seedUser();
    const b = seedUser();
    markSeen(a, 'spray_first');
    expect(listSeen(a).map((h) => h.key)).toEqual(['spray_first']);
    expect(listSeen(b)).toEqual([]);
  });

  it('caps new keys per user but still accepts already-seen ones', () => {
    const u = seedUser();
    db.insert(userHints)
      .values(
        Array.from({ length: MAX_HINTS_PER_USER }, (_, i) => ({
          userId: u,
          hintKey: `k_${i}`,
          seenAt: new Date(i)
        }))
      )
      .run();
    expect(markSeen(u, 'one_more')).toBe(false);
    expect(markSeen(u, 'k_0')).toBe(true);
    expect(listSeen(u)).toHaveLength(MAX_HINTS_PER_USER);
  });

  it('is removed with the user', () => {
    const u = seedUser();
    markSeen(u, 'map_filter');
    db.delete(users).where(eq(users.id, u)).run();
    expect(listSeen(u)).toEqual([]);
  });
});
