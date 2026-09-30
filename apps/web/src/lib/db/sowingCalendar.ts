/**
 * Reads for the sowing calendar (E3): each planting's establishment, tray
 * sow date and `seedstart:` tasks, in two queries for the whole season.
 */

import { inArray, like } from 'drizzle-orm';
import { db } from './client';
import { crops, tasks } from './schema';
import { withTenant } from './tenant';
import type { SeedStartFacts, SeedStartTaskStep } from '$lib/calendar/engine';

const STEPS: readonly SeedStartTaskStep[] = ['sow', 'harden', 'transplant'];
const CHUNK = 500;

/** `seedstart:<cropId>:<step>` → its parts, or null for any other key. */
export function parseSeedStartKey(
  key: string | null | undefined
): { cropId: string; step: SeedStartTaskStep } | null {
  if (!key || !key.startsWith('seedstart:')) return null;
  const rest = key.slice('seedstart:'.length);
  const cut = rest.lastIndexOf(':');
  if (cut <= 0) return null;
  const step = rest.slice(cut + 1) as SeedStartTaskStep;
  if (!STEPS.includes(step)) return null;
  return { cropId: rest.slice(0, cut), step };
}

type MutableFacts = Omit<SeedStartFacts, 'tasks'> & { tasks: SeedStartFacts['tasks'][number][] };

export function listSeedStartFacts(cropIds: readonly string[]): Map<string, SeedStartFacts> {
  const out = new Map<string, MutableFacts>();
  const ids = [...new Set(cropIds)];
  if (ids.length === 0) return out;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    for (const r of db
      .select({
        id: crops.id,
        establishment: crops.establishment,
        sownIndoorsAt: crops.sownIndoorsAt
      })
      .from(crops)
      .where(withTenant(crops, inArray(crops.id, chunk)))
      .all()) {
      out.set(r.id, {
        establishment: r.establishment ?? null,
        sownIndoorsAt: r.sownIndoorsAt ? r.sownIndoorsAt.getTime() : null,
        tasks: []
      });
    }
  }
  const rows = db
    .select({
      cropId: tasks.cropId,
      key: tasks.pluginTemplateKey,
      scheduledFor: tasks.scheduledFor,
      completedAt: tasks.completedAt,
      abortedAt: tasks.abortedAt
    })
    .from(tasks)
    .where(withTenant(tasks, like(tasks.pluginTemplateKey, 'seedstart:%')))
    .all();
  for (const r of rows) {
    const parsed = parseSeedStartKey(r.key);
    if (!parsed) continue;
    const facts = out.get(r.cropId ?? parsed.cropId);
    if (!facts) continue;
    facts.tasks.push({
      step: parsed.step,
      scheduledFor: r.scheduledFor.getTime(),
      completedAt: r.completedAt?.getTime(),
      abortedAt: r.abortedAt?.getTime()
    });
  }
  return out;
}
