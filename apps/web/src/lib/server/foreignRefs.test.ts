// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { seedPhase32Rows, type Phase32Seed } from '$lib/db/phase32.fixtures';
import {
  assertAnimalSubject,
  assertAssignableUser,
  assertField,
  assertStockLot,
  firstUnknownRef,
  rejectForeignRefs
} from './foreignRefs';

const tag = randomUUID().slice(0, 8);
const OWNER_A = `refs-a-${tag}`;
const OWNER_B = `refs-b-${tag}`;

type Role = (typeof helperAssignments.$inferInsert)['roleWithinOwner'];
type Status = NonNullable<(typeof helperAssignments.$inferInsert)['status']>;

function seedOwner(id: string) {
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
}

function seedMember(ownerId: string, role: Role, status: Status = 'active'): string {
  const userId = `${ownerId}-${role}-${status}-${randomUUID().slice(0, 6)}`;
  db.insert(users)
    .values({ id: userId, email: `${userId}@refs.test` })
    .run();
  db.insert(helperAssignments).values({ ownerId, userId, roleWithinOwner: role, status }).run();
  return userId;
}

let a: Phase32Seed;
let b: Phase32Seed;
const members: Record<string, string> = {};

beforeAll(() => {
  seedOwner(OWNER_A);
  seedOwner(OWNER_B);
  a = runWithTenant(OWNER_A, () => seedPhase32Rows(`refs-a-${tag}`));
  b = runWithTenant(OWNER_B, () => seedPhase32Rows(`refs-b-${tag}`));
  members.owner = seedMember(OWNER_A, 'owner');
  members.helper = seedMember(OWNER_A, 'helper');
  members.operator = seedMember(OWNER_A, 'custom-operator');
  members.inspector = seedMember(OWNER_A, 'inspector');
  members.revoked = seedMember(OWNER_A, 'helper', 'revoked');
  members.pending = seedMember(OWNER_A, 'helper', 'pending');
  members.otherHelper = seedMember(OWNER_B, 'helper');
});

const inA = <T>(fn: () => T) => runWithTenant(OWNER_A, fn);

describe('assertField', () => {
  it("accepts the Owner's Area, refuses another Owner's and unknown ids, skips a missing id", () => {
    inA(() => {
      expect(firstUnknownRef(assertField('fieldId', a.fieldId))).toBeNull();
      expect(firstUnknownRef(assertField('fieldId', b.fieldId))).toBe('fieldId');
      expect(firstUnknownRef(assertField('fieldId', 'nope'))).toBe('fieldId');
      expect(firstUnknownRef(assertField('fieldId', undefined))).toBeNull();
      expect(firstUnknownRef(assertField('fieldId', null))).toBeNull();
    });
  });
});

describe('assertStockLot', () => {
  it("accepts the Owner's lot and refuses another Owner's", () => {
    inA(() => {
      expect(firstUnknownRef(assertStockLot('stockLotId', a.stockLotId))).toBeNull();
      expect(firstUnknownRef(assertStockLot('stockLotId', b.stockLotId))).toBe('stockLotId');
    });
  });
});

describe('assertAnimalSubject', () => {
  it('matches the id against its stated subject type', () => {
    inA(() => {
      const ok = (type: string, id: string) =>
        firstUnknownRef(assertAnimalSubject('subjectId', type, id)) === null;
      expect(ok('animal', a.animalId)).toBe(true);
      expect(ok('group', a.groupId)).toBe(true);
      expect(ok('group', a.animalId)).toBe(false);
      expect(ok('animal', a.groupId)).toBe(false);
      expect(ok('flock', a.groupId)).toBe(false);
      expect(ok('animal', b.animalId)).toBe(false);
      expect(ok('group', b.groupId)).toBe(false);
    });
  });

  it("never resolves another Owner's subject, whatever the type", () => {
    fc.assert(
      fc.property(
        fc.constantFrom('animal', 'group', '', 'Animal', 'group '),
        fc.constantFrom(b.animalId, b.groupId),
        (type, id) => {
          inA(() => {
            expect(firstUnknownRef(assertAnimalSubject('subjectId', type, id))).toBe('subjectId');
          });
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('assertAssignableUser', () => {
  it('accepts active working members of this Owner only', () => {
    inA(() => {
      const ok = (id: string) =>
        firstUnknownRef(assertAssignableUser('assigneeUserId', id)) === null;
      expect(ok(members.owner)).toBe(true);
      expect(ok(members.helper)).toBe(true);
      expect(ok(members.operator)).toBe(true);
      expect(ok(members.inspector)).toBe(false);
      expect(ok(members.revoked)).toBe(false);
      expect(ok(members.pending)).toBe(false);
      expect(ok(members.otherHelper)).toBe(false);
      expect(ok('no-such-user')).toBe(false);
    });
  });

  it("refuses this Owner's helper when the request runs as another Owner", () => {
    runWithTenant(OWNER_B, () => {
      expect(firstUnknownRef(assertAssignableUser('assigneeUserId', members.helper))).toBe(
        'assigneeUserId'
      );
      expect(firstUnknownRef(assertAssignableUser('assigneeUserId', members.otherHelper))).toBe(
        null
      );
    });
  });
});

describe('rejectForeignRefs with the Phase 32 checkers', () => {
  it('answers 400 naming the first foreign field', async () => {
    const res = inA(() =>
      rejectForeignRefs(
        assertField('fieldId', a.fieldId),
        assertAnimalSubject('subjectId', 'group', a.groupId),
        assertStockLot('stockLotId', b.stockLotId),
        assertAssignableUser('assigneeUserId', members.otherHelper)
      )
    );
    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: 'unknown stockLotId' });
  });
});
