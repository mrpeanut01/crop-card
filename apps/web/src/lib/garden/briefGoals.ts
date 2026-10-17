/** Phase 37C: the storage goals out of a saved garden brief. 37A owns the
 *  brief's schema (`lib/garden/brief/schema.ts`), so this reads it
 *  defensively: it takes the first array it finds under one of the goal
 *  field names, each entry a goal name or `{ goal | method, target?,
 *  provenance? }`, and drops anything it does not recognise. A missing or
 *  broken brief reads as no goals. Client-safe. */

import { z } from 'zod';
import { BRIEF_STORAGE_GOALS, type BriefStorageGoal } from './preserving';

export const BRIEF_SETTING_KEY = 'garden_brief';

export type BriefGoalProvenance = 'plugin' | 'data' | 'ai' | 'manual' | 'fallback';

export interface BriefGoal {
  goal: BriefStorageGoal;
  target: string | null;
  provenance: BriefGoalProvenance;
}

const PROVENANCES = ['plugin', 'data', 'ai', 'manual', 'fallback'] as const;
const GOAL_FIELDS = ['storageGoals', 'storage', 'harvestGoals', 'goals', 'harvest'] as const;

const goalName = z.enum(BRIEF_STORAGE_GOALS);
const provenance = z.enum(PROVENANCES).optional().catch(undefined);
const target = z.string().trim().max(200).nullable().optional().catch(undefined);

const entrySchema = z.union([
  goalName.transform((goal) => ({ goal, target: null, provenance: undefined })),
  z
    .object({
      goal: goalName.optional().catch(undefined),
      method: goalName.optional().catch(undefined),
      value: goalName.optional().catch(undefined),
      target,
      provenance
    })
    .transform((v) => ({
      goal: v.goal ?? v.method ?? v.value,
      target: v.target ?? null,
      provenance: v.provenance
    }))
]);

function goalArray(v: unknown, depth = 0): unknown[] | null {
  if (!v || typeof v !== 'object' || depth > 3) return null;
  if (Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  for (const field of GOAL_FIELDS) {
    const inner = o[field];
    if (Array.isArray(inner)) return inner;
    if (inner && typeof inner === 'object') {
      const nested = goalArray(inner, depth + 1);
      if (nested) return nested;
    }
  }
  if (o.answers && typeof o.answers === 'object') return goalArray(o.answers, depth + 1);
  return null;
}

/** The goals in a brief, once each, in the brief's order. */
export function briefGoalsFrom(value: unknown): BriefGoal[] {
  const list = goalArray(value) ?? [];
  const container =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  const outer = provenance.parse(
    (container?.storage as Record<string, unknown> | undefined)?.provenance
  );
  const seen = new Set<BriefStorageGoal>();
  const out: BriefGoal[] = [];
  for (const raw of list) {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success || !parsed.data.goal || seen.has(parsed.data.goal)) continue;
    seen.add(parsed.data.goal);
    out.push({
      goal: parsed.data.goal,
      target: parsed.data.target ?? null,
      provenance: parsed.data.provenance ?? outer ?? 'manual'
    });
  }
  return out;
}

/** The goals in the stored setting text. */
export function briefGoalsFromSetting(raw: string | null | undefined): BriefGoal[] {
  if (!raw) return [];
  try {
    return briefGoalsFrom(JSON.parse(raw));
  } catch {
    return [];
  }
}
