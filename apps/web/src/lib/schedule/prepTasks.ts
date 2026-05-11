import { DAY_MS, type TillageMethod } from './constants';

export interface ScheduledActivity {
  kind: 'prep' | 'spray' | 'fertility' | 'harvest' | 'task' | 'planting' | 'post-harvest';
  source: 'prep-generator' | 'engine' | 'task-record' | 'fertility-record';
  startMs: number;
  endMs: number;
  title: string;
  body?: string;
  blockId: string;
  cropId?: string;
  conflictLevel: 'none' | 'warn' | 'block';
}

interface PrepRule {
  title: string;
  body?: string;
  startOffsetDays: number;
  endOffsetDays: number;
}

const PREP_RULES: Record<TillageMethod, PrepRule[]> = {
  conventional: [
    {
      title: 'Primary tillage (chisel plow / moldboard)',
      body: 'Break up compaction and bury residue before secondary tillage.',
      startOffsetDays: 28,
      endOffsetDays: 21
    },
    {
      title: 'Secondary tillage (disk / harrow)',
      body: 'Level the seedbed after primary tillage.',
      startOffsetDays: 10,
      endOffsetDays: 7
    },
    {
      title: 'Final seedbed prep (field cultivator)',
      body: 'Final pass to kill any emerged weeds and firm the seedbed.',
      startOffsetDays: 5,
      endOffsetDays: 3
    },
    {
      title: 'Pre-plant fertilizer window',
      body: 'Apply and incorporate starter or pre-plant N/P/K before seeding.',
      startOffsetDays: 14,
      endOffsetDays: 7
    },
    {
      title: 'Equipment pre-check',
      body: 'Verify planter calibration, seed meters, and closing wheels.',
      startOffsetDays: 2,
      endOffsetDays: 1
    }
  ],
  'reduced-till': [
    {
      title: 'Single-pass tillage (strip-till / vertical tillage)',
      body: 'One pass to break the previous crop residue and loosen strips.',
      startOffsetDays: 10,
      endOffsetDays: 7
    },
    {
      title: 'Burndown spray window',
      body: 'Glyphosate or contact herbicide to terminate existing vegetation before planting.',
      startOffsetDays: 14,
      endOffsetDays: 7
    },
    {
      title: 'Pre-plant fertilizer window',
      body: 'Surface-apply or band fertilizer before or at planting.',
      startOffsetDays: 14,
      endOffsetDays: 7
    },
    {
      title: 'Equipment pre-check',
      body: 'Verify no-till coulter depth, planter row-cleaners, and down pressure.',
      startOffsetDays: 2,
      endOffsetDays: 1
    }
  ],
  'no-till': [
    {
      title: 'Burndown spray window',
      body: 'Apply burndown herbicide (glyphosate, paraquat, or contact) to terminate existing vegetation. Allow residue to die back fully before planting.',
      startOffsetDays: 14,
      endOffsetDays: 7
    },
    {
      title: 'Pre-plant fertilizer window',
      body: 'Surface-apply fertilizer; no incorporation. Consider split application to reduce runoff.',
      startOffsetDays: 14,
      endOffsetDays: 7
    },
    {
      title: 'Equipment pre-check',
      body: 'Verify no-till drill coulter depth, seed disk openers, and residue managers.',
      startOffsetDays: 2,
      endOffsetDays: 1
    }
  ]
};

/**
 * Generate tillage-method-aware pre-planting prep activities for a given
 * planting date. Pure function — no DB calls; safe to call client-side.
 */
export function prepTasksForPlanting(
  plantingDateMs: number,
  tillage: TillageMethod,
  blockId: string
): ScheduledActivity[] {
  return PREP_RULES[tillage].map((rule) => ({
    kind: 'prep' as const,
    source: 'prep-generator' as const,
    startMs: plantingDateMs - rule.startOffsetDays * DAY_MS,
    endMs: plantingDateMs - rule.endOffsetDays * DAY_MS,
    title: rule.title,
    body: rule.body,
    blockId,
    conflictLevel: 'none' as const
  }));
}
