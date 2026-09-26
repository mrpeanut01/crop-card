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
export function taskStart(task: TaskStartInput): TaskStart | null {
  const block = task.blockId ?? null;
  switch (task.relatedEventTable) {
    case 'spray_event':
      return { href: withParams('/spray', { task: task.id, block }), label: 'Start spraying' };
    case 'insecticide_event':
      return {
        href: withParams('/spray/insecticide', { task: task.id, block }),
        label: 'Start spraying'
      };
    case 'fungicide_event':
      return {
        href: withParams('/spray/fungicide', { task: task.id, block }),
        label: 'Start spraying'
      };
    case 'harvest_event':
      return { href: '/harvest', label: 'Start harvest' };
    case 'hay_cutting':
      return { href: '/hay', label: 'Start cutting' };
    case 'fertility_application':
      return { href: '/fertility', label: 'Start feeding' };
  }
  switch (task.category) {
    case 'spray':
      return { href: withParams('/spray', { task: task.id, block }), label: 'Start spraying' };
    case 'scout':
    case 'companion-check':
      return { href: withParams('/scout', { block }), label: 'Start scouting' };
    case 'harvest':
      return { href: '/harvest', label: 'Start harvest' };
    case 'hay-cutting':
      return { href: '/hay', label: 'Start cutting' };
    case 'fertilize':
      return { href: '/fertility', label: 'Start feeding' };
    default:
      return null;
  }
}
