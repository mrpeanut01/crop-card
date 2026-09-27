// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { db } from './client';
import { owners } from './schema';
import { runWithTenant } from './tenant';
import { createField } from './fields';
import { getAnimal, insertAnimal } from './animals';
import { getAnimalGroup, insertAnimalGroup } from './animalGroups';
import {
  currentHousing,
  deleteLatestStay,
  housedOnField,
  listLocationsForSubject
} from './animalLocations';
import { applyMove, planMove, AnimalRuleError } from '$lib/server/animals';
import { isNonOverlapping, openStay } from '$lib/animals/timeline';

function seedOwner(): string {
  const id = `animal-loc-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

const HOUR = 3600_000;

describe('animal location timelines', () => {
  it('stay non-overlapping, with the cache on the open stay, under random interleaved moves', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 500 }), fc.integer({ min: 0, max: 2 })), {
          minLength: 1,
          maxLength: 15
        }),
        (moves) => {
          runWithTenant(seedOwner(), () => {
            const fields = ['A', 'B', 'C'].map((n) => createField({ name: n, kind: 'pasture' }));
            const group = insertAnimalGroup({
              name: 'Ewes',
              speciesId: 'sheep',
              purpose: 'production',
              headCount: 12,
              foodProducing: true
            });
            const now = Date.now();
            for (const [hoursAgo, f] of moves) {
              try {
                const plan = planMove(
                  {
                    subjectType: 'group',
                    subjectId: group.id,
                    fieldId: fields[f].id,
                    movedAt: now - hoursAgo * HOUR
                  },
                  now
                );
                db.transaction(() => applyMove(plan, { movedBy: null }, now));
              } catch (e) {
                expect(e).toBeInstanceOf(AnimalRuleError);
                expect(['SAME_TIME', 'ALREADY_THERE']).toContain((e as AnimalRuleError).code);
              }
            }
            const stays = listLocationsForSubject('group', group.id);
            expect(isNonOverlapping(stays)).toBe(true);
            expect(stays.filter((s) => s.toMs === null).length).toBeLessThanOrEqual(1);
            expect(getAnimalGroup(group.id)?.housingFieldId ?? null).toBe(
              openStay(stays)?.fieldId ?? null
            );
          });
        }
      ),
      { numRuns: 40 }
    );
  });

  it('keeps a grouped individual housed with its group and counts it on the Area', () => {
    runWithTenant(seedOwner(), () => {
      const coop = createField({ name: 'Coop', kind: 'barn' });
      const yard = createField({ name: 'Yard', kind: 'pasture' });
      const group = insertAnimalGroup({
        name: 'Layers',
        speciesId: 'chicken',
        purpose: 'production',
        headCount: 10,
        foodProducing: true
      });
      const hen = insertAnimal({
        speciesId: 'chicken',
        groupId: group.id,
        name: 'Pearl',
        purpose: 'production',
        foodProducing: true
      });
      const dog = insertAnimal({
        speciesId: 'dog',
        name: 'Rex',
        purpose: 'pet',
        foodProducing: false
      });
      db.transaction(() =>
        applyMove(planMove({ subjectType: 'group', subjectId: group.id, fieldId: coop.id }), {
          movedBy: null
        })
      );
      db.transaction(() =>
        applyMove(planMove({ subjectType: 'animal', subjectId: dog.id, fieldId: coop.id }), {
          movedBy: null
        })
      );
      expect(getAnimal(hen.id)?.housingFieldId).toBe(coop.id);
      expect(currentHousing({ subjectType: 'animal', subjectId: hen.id })).toBe(coop.id);
      const here = housedOnField(coop.id);
      expect(here.total).toBe(12);
      expect(here.groups.map((g) => g.total)).toEqual([11]);
      expect(here.animals.map((a) => a.id)).toEqual([dog.id]);
      expect(housedOnField(yard.id).total).toBe(0);
    });
  });

  it('only undoes the latest plain stay', () => {
    runWithTenant(seedOwner(), () => {
      const [a, b] = ['A', 'B'].map((n) => createField({ name: n, kind: 'pasture' }));
      const dog = insertAnimal({
        speciesId: 'dog',
        name: 'Rex',
        purpose: 'pet',
        foodProducing: false
      });
      const now = Date.now();
      for (const [f, at] of [
        [a, now - 2 * HOUR],
        [b, now - HOUR]
      ] as const) {
        db.transaction(() =>
          applyMove(
            planMove({ subjectType: 'animal', subjectId: dog.id, fieldId: f.id, movedAt: at }, now),
            { movedBy: null }
          )
        );
      }
      const [first, second] = listLocationsForSubject('animal', dog.id);
      expect(deleteLatestStay(first.id)).toEqual({ ok: false, reason: 'not-latest' });
      expect(deleteLatestStay('missing')).toEqual({ ok: false, reason: 'not-found' });
      const undone = deleteLatestStay(second.id);
      expect(undone.ok).toBe(true);
      expect(getAnimal(dog.id)?.housingFieldId).toBe(a.id);
    });
  });
});
