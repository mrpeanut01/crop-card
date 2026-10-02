import { t } from '$lib/i18n';
import type { TaskCategory } from '$lib/plan/taskCategory';

export interface TaskStartInput {
  id: string;
  relatedEventTable?: string | null;
  category?: TaskCategory | null;
  blockId?: string | null;
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
 * Where "Start" takes a task. The spray flows take `?task=` and close the
 * task when the record saves; the other flows open on the right block and
 * the owner taps Done afterwards. Null when there is no flow to open.
 */
export function taskStart(task: TaskStartInput, locale?: string | null): TaskStart | null {
  const block = task.blockId ?? null;
  const spraying = t(locale, 'tasks.start.spraying');
  switch (task.relatedEventTable) {
    case 'spray_event':
      return { href: withParams('/spray', { task: task.id, block }), label: spraying };
    case 'insecticide_event':
      return {
        href: withParams('/spray/insecticide', { task: task.id, block }),
        label: spraying
      };
    case 'fungicide_event':
      return {
        href: withParams('/spray/fungicide', { task: task.id, block }),
        label: spraying
      };
    case 'harvest_event':
      return { href: '/harvest', label: t(locale, 'tasks.start.harvest') };
    case 'hay_cutting':
      return { href: '/hay', label: t(locale, 'tasks.start.cutting') };
    case 'fertility_application':
      return { href: '/fertility', label: t(locale, 'tasks.start.feeding') };
  }
  switch (task.category) {
    case 'spray':
      return { href: withParams('/spray', { task: task.id, block }), label: spraying };
    case 'scout':
    case 'companion-check':
      return { href: withParams('/scout', { block }), label: t(locale, 'tasks.start.scouting') };
    case 'harvest':
      return { href: '/harvest', label: t(locale, 'tasks.start.harvest') };
    case 'hay-cutting':
      return { href: '/hay', label: t(locale, 'tasks.start.cutting') };
    case 'fertilize':
      return { href: '/fertility', label: t(locale, 'tasks.start.feeding') };
    default:
      return null;
  }
}
