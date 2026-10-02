import { t } from '$lib/i18n';
import type { TaskCategory } from '$lib/plan/taskCategory';

export interface TaskStartInput {
  id: string;
  relatedEventTable?: string | null;
  category?: TaskCategory | null;
  blockId?: string | null;
  cropId?: string | null;
}

export interface TaskStart {
  href: string;
  label: string;
}

function withParams(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Where "Start" takes a task. Every flow gets `?task=` plus the task's block
 * and planting, and closes the task in the same transaction as the record
 * it saves (TC-02, TC-04). Null when there is no flow to open.
 */
export function taskStart(task: TaskStartInput, locale?: string | null): TaskStart | null {
  const params = { task: task.id, block: task.blockId ?? null, crop: task.cropId ?? null };
  const spray = (path: string): TaskStart => ({
    href: withParams(path, params),
    label: t(locale, 'tasks.start.spraying')
  });
  const harvest = (): TaskStart => ({
    href: withParams('/harvest', params),
    label: t(locale, 'tasks.start.harvest')
  });
  const hay = (): TaskStart => ({
    href: withParams('/hay', params),
    label: t(locale, 'tasks.start.cutting')
  });
  const fertility = (): TaskStart => ({
    href: withParams('/fertility', params),
    label: t(locale, 'tasks.start.feeding')
  });
  switch (task.relatedEventTable) {
    case 'spray_event':
      return spray('/spray');
    case 'insecticide_event':
      return spray('/spray/insecticide');
    case 'fungicide_event':
      return spray('/spray/fungicide');
    case 'harvest_event':
      return harvest();
    case 'hay_cutting':
      return hay();
    case 'fertility_application':
      return fertility();
  }
  switch (task.category) {
    case 'spray':
      return spray('/spray');
    case 'scout':
    case 'companion-check':
      return {
        href: withParams('/scout', params),
        label: t(locale, 'tasks.start.scouting')
      };
    case 'harvest':
      return harvest();
    case 'hay-cutting':
      return hay();
    case 'fertilize':
      return fertility();
    default:
      return null;
  }
}
