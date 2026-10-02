// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runWithTenant } from '$lib/db/tenant';
import { createBlock } from '$lib/db/blocks';
import { insertOrganicStatusEntry } from '$lib/db/organicStatus';
import { seedFarm } from '$lib/server/documents.testkit';
import { organicBlocksForNotice } from './organicNotice';

const DAY = 86_400_000;

describe('organicBlocksForNotice (B-21)', () => {
  it('is null while the farm has no status entry', () => {
    const farm = seedFarm();
    expect(runWithTenant(farm.ownerId, () => organicBlocksForNotice([farm.blockId]))).toBeNull();
  });

  it('lists organic and transitioning blocks with their line, and skips the rest', () => {
    const farm = seedFarm();
    const out = runWithTenant(farm.ownerId, () => {
      const other = createBlock({ name: 'Other bed', fieldId: farm.fieldId, kind: 'bed' });
      const future = createBlock({ name: 'Later bed', fieldId: farm.fieldId, kind: 'bed' });
      const base = { certifier: null, note: null, createdBy: farm.ownerUser };
      insertOrganicStatusEntry({
        ...base,
        subjectType: 'field',
        subjectId: farm.fieldId,
        status: 'transitioning',
        effectiveAt: Date.now() - 30 * DAY,
        certifier: 'OCIA'
      });
      insertOrganicStatusEntry({
        ...base,
        subjectType: 'block',
        subjectId: other.id,
        status: 'not-organic',
        effectiveAt: Date.now() - 10 * DAY
      });
      insertOrganicStatusEntry({
        ...base,
        subjectType: 'block',
        subjectId: future.id,
        status: 'not-organic',
        effectiveAt: Date.now() - 10 * DAY
      });
      insertOrganicStatusEntry({
        ...base,
        subjectType: 'block',
        subjectId: future.id,
        status: 'organic',
        effectiveAt: Date.now() + 30 * DAY
      });
      return organicBlocksForNotice([farm.blockId, other.id, future.id]);
    });
    expect(Object.keys(out!)).toEqual([farm.blockId]);
    expect(out![farm.blockId]).toMatch(
      /^Transitioning \(owner-entered, effective .+, certifier OCIA\)/
    );
  });

  it('never reads another farm statuses', () => {
    const a = seedFarm();
    const b = seedFarm();
    runWithTenant(a.ownerId, () =>
      insertOrganicStatusEntry({
        subjectType: 'block',
        subjectId: a.blockId,
        status: 'organic',
        effectiveAt: Date.now() - DAY,
        certifier: null,
        note: null,
        createdBy: a.ownerUser
      })
    );
    expect(
      runWithTenant(b.ownerId, () => organicBlocksForNotice([a.blockId, b.blockId]))
    ).toBeNull();
  });
});
