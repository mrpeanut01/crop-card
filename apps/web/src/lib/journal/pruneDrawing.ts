/** The growth-habit line drawing beside a Care Guide answer (Phase 37F).
 *  The drawings under `static/prune/` carry no words; their captions are
 *  only the Care Guide's own text (R-25), or one line saying none is
 *  sourced yet. Client-safe. */

import { t } from '$lib/i18n';
import type { GrowthHabit } from '$lib/plugins/schemas';
import type { JournalAnswerSection } from './model';
import { CARE_SECTION, type CareTopic } from './photoHelp';

export const PRUNE_DRAWINGS = [
  'cut-and-come-again-leafy',
  'woody-perennial-herb',
  'clumping-herb',
  'vining',
  'tree'
] as const;
export type PruneDrawingId = (typeof PRUNE_DRAWINGS)[number];

const BY_HABIT: Record<GrowthHabit, PruneDrawingId> = {
  woody: 'woody-perennial-herb',
  clumping: 'clumping-herb'
};

const BY_ARCHETYPE: Readonly<Record<string, PruneDrawingId>> = {
  'cut-and-come-again-leafy': 'cut-and-come-again-leafy',
  'perennial-vine-quality': 'vining',
  'tree-fruit-multi-pick': 'tree'
};

export interface DrawingPlugin {
  archetype?: string | null;
  growthHabit?: GrowthHabit | null;
}

/** A sourced growth habit wins; otherwise the crop's archetype picks the
 *  drawing. Null for a crop no drawing fits. */
export function pruneDrawingFor(plugin: DrawingPlugin | null | undefined): PruneDrawingId | null {
  if (!plugin) return null;
  if (plugin.growthHabit) return BY_HABIT[plugin.growthHabit];
  return (plugin.archetype && BY_ARCHETYPE[plugin.archetype]) || null;
}

/** Only pruning and harvest questions get a drawing. */
export function drawingTopic(topic: CareTopic): boolean {
  return topic === 'prune' || topic === 'harvest';
}

export function isPruneDrawing(v: unknown): v is PruneDrawingId {
  return typeof v === 'string' && (PRUNE_DRAWINGS as readonly string[]).includes(v);
}

export function pruneDrawingSrc(id: PruneDrawingId): string {
  return `/prune/${id}.svg`;
}

export const NO_DRAWING_STEPS = 'No pruning steps sourced yet for this crop';

export interface DrawingCaption {
  items: string[];
  provenance: 'plugin' | 'fallback';
}

const CAPTION_TITLES: readonly string[] = [CARE_SECTION.prune, CARE_SECTION.harvest];

/** The caption under a drawing: the answer's own Care Guide prune or harvest
 *  section, as stored (English titles), or the "none sourced" line. */
export function drawingCaption(
  sections: readonly JournalAnswerSection[],
  locale?: string | null
): DrawingCaption {
  const found = sections.find((s) => CAPTION_TITLES.includes(s.title) && s.items.length > 0);
  if (found) return { items: [...found.items], provenance: found.provenance ?? 'fallback' };
  return {
    items: [locale ? t(locale, 'herbsf.drawing.noSteps') : NO_DRAWING_STEPS],
    provenance: 'fallback'
  };
}
