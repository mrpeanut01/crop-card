// @vitest-environment node
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { db } from './client';
import { owners } from './schema';
import { runWithTenant } from './tenant';
import { createField } from './fields';
import {
  deleteIrrigationEvent,
  deleteRainGaugeReading,
  getIrrigationEvent,
  getRainGaugeReading,
  insertIrrigationEvent,
  insertRainGaugeReading,
  listIrrigationEvents,
  listRainGaugeReadings,
  previousGaugeReading
} from './irrigation';

function owner(): string {
  const id = `irr-x-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

describe('irrigation repos stay inside the active Owner', () => {
  it("never read, list or delete another Owner's logs or readings", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        fc.boolean(),
        (logs, readings, useFieldFilter) => {
          const a = owner();
          const b = owner();
          const seeded = runWithTenant(a, () => {
            const f = createField({ name: 'A garden', kind: 'garden' });
            const ids = Array.from(
              { length: logs },
              (_, i) =>
                insertIrrigationEvent({ fieldId: f.id, occurredAt: 1_000 + i, inches: 0.5 }).id
            );
            const rids = Array.from(
              { length: readings },
              (_, i) => insertRainGaugeReading({ fieldId: f.id, readAt: 2_000 + i, inches: 0.1 }).id
            );
            return { fieldId: f.id, ids, rids };
          });
          runWithTenant(b, () => {
            const filter = useFieldFilter ? { fieldIds: [seeded.fieldId] } : {};
            expect(listIrrigationEvents(filter)).toEqual([]);
            expect(listRainGaugeReadings(filter)).toEqual([]);
            expect(previousGaugeReading(seeded.fieldId, 10_000)).toBeUndefined();
            for (const id of seeded.ids) {
              expect(getIrrigationEvent(id)).toBeUndefined();
              expect(deleteIrrigationEvent(id)).toBe(false);
            }
            for (const id of seeded.rids) {
              expect(getRainGaugeReading(id)).toBeUndefined();
              expect(deleteRainGaugeReading(id)).toBe(false);
            }
          });
          runWithTenant(a, () => {
            expect(listIrrigationEvents()).toHaveLength(logs);
            expect(listRainGaugeReadings()).toHaveLength(readings);
          });
        }
      ),
      { numRuns: 15 }
    );
  });
});
