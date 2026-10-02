// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { insertAnimal, setAnimalGroupAndHousing } from '$lib/db/animals';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { endStayAt, insertStay } from '$lib/db/animalLocations';
import { manureSourceStays, manureSources } from './animalFoodGate';

const DAY = 86_400_000;

function seed() {
  const ownerId = `manure-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const pasture = createField({ name: 'Pasture', kind: 'pasture' });
    const group = insertAnimalGroup({
      name: 'Goats',
      speciesId: 'goat',
      purpose: 'production',
      headCount: 1,
      foodProducing: true
    });
    const bella = insertAnimal({
      speciesId: 'goat',
      name: 'Bella',
      purpose: 'production',
      foodProducing: true,
      groupId: group.id
    });
    insertStay({
      subject: { subjectType: 'group', subjectId: group.id },
      fieldId: pasture.id,
      atMs: Date.now() - 10 * DAY,
      movedBy: null
    });
    return { ownerId, pastureId: pasture.id, groupId: group.id, bellaId: bella.id };
  });
}

describe('manureSources (M-30)', () => {
  const window = { fromMs: Date.now() - 5 * DAY, toMs: Date.now() };

  it("an animal's input reaches its group's stays and the group's feed", () => {
    const s = seed();
    runWithTenant(s.ownerId, () => {
      const found = manureSources({ type: 'animal', id: s.bellaId }, window);
      expect(found.stays).toEqual([
        expect.objectContaining({
          fieldId: s.pastureId,
          subjectType: 'group',
          subjectId: s.groupId
        })
      ]);
      expect(found.feedReach.map((r) => `${r.subjectType}:${r.subjectId}`)).toEqual([
        `animal:${s.bellaId}`,
        `group:${s.groupId}`
      ]);
      expect(manureSourceStays({ type: 'animal', id: s.bellaId }, window)).toHaveLength(1);
    });
  });

  it("a group's input reaches its own stays and feed naming its members", () => {
    const s = seed();
    runWithTenant(s.ownerId, () => {
      const found = manureSources({ type: 'group', id: s.groupId }, window);
      expect(found.stays.map((x) => x.subjectId)).toContain(s.groupId);
      expect(found.feedReach.map((r) => `${r.subjectType}:${r.subjectId}`)).toEqual(
        expect.arrayContaining([`group:${s.groupId}`, `animal:${s.bellaId}`])
      );
    });
  });

  it("never reads another Owner's animals", () => {
    const mine = seed();
    const theirs = seed();
    runWithTenant(mine.ownerId, () => {
      expect(manureSources({ type: 'group', id: theirs.groupId }, window).stays).toEqual([]);
      expect(manureSourceStays({ type: 'animal', id: theirs.bellaId }, window)).toEqual([]);
    });
  });

  it("a group's input reaches feed a member ate on its own before joining", () => {
    const s = seed();
    runWithTenant(s.ownerId, () => {
      const x = insertAnimal({
        speciesId: 'goat',
        name: 'X',
        purpose: 'production',
        foodProducing: true
      });
      const subject = { subjectType: 'animal' as const, subjectId: x.id };
      insertStay({ subject, fieldId: s.pastureId, atMs: Date.now() - 20 * DAY, movedBy: null });
      const joinedAt = Date.now() - 3 * DAY;
      endStayAt(subject, joinedAt, s.groupId);
      setAnimalGroupAndHousing(x.id, s.groupId, null);
      const found = manureSources(
        { type: 'group', id: s.groupId },
        { fromMs: joinedAt, toMs: Date.now() }
      );
      const own = found.feedReach.filter((r) => r.subjectType === 'animal' && r.subjectId === x.id);
      expect(own).toEqual([{ subjectType: 'animal', subjectId: x.id, fromMs: null, toMs: null }]);
      expect(found.missing).toBe(false);
    });
  });

  it('marks an input whose animal or group is no longer on file as missing', () => {
    const s = seed();
    runWithTenant(s.ownerId, () => {
      expect(manureSources({ type: 'animal', id: 'gone' }, window).missing).toBe(true);
      expect(manureSources({ type: 'group', id: 'gone' }, window).missing).toBe(true);
    });
  });
});
