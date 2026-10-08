import { formatCalendarDate, intlLocale } from '$lib/prefs';
import { numberToLocaleString } from '$lib/intlCache';
import type { ProgressStage, SufficiencyResult } from './types';
import { wlocale, wt } from './wt';

function num(n: number): string {
  return numberToLocaleString(n, intlLocale(wlocale()));
}

export function fmtDateMs(ms: number): string {
  return formatCalendarDate(ms, 'date', {}, wlocale());
}

// ─── AI progress heartbeat ──────────────────────────────────────────────
// Long Sonnet calls (allocator, scheduler, chat refinement) can run 30-120s.
// Without feedback "Generating…" reads as a hang. Stage labels are
// time-windowed narration — not real progress from the server, but plenty
// to communicate "the system is alive and working."
export function aiProgressLabel(stage: ProgressStage, elapsedMs: number): string {
  const s = Math.floor(elapsedMs / 1000);
  if (stage === 'allocate') {
    if (s < 3) return wt('wizard.ai.allocate.1');
    if (s < 12) return wt('wizard.ai.allocate.2');
    if (s < 30) return wt('wizard.ai.allocate.3');
    if (s < 60) return wt('wizard.ai.allocate.4');
    if (s < 120) return wt('wizard.ai.allocate.5');
    return wt('wizard.ai.slow');
  }
  if (stage === 'schedule') {
    if (s < 3) return wt('wizard.ai.schedule.1');
    if (s < 12) return wt('wizard.ai.schedule.2');
    if (s < 30) return wt('wizard.ai.schedule.3');
    if (s < 60) return wt('wizard.ai.schedule.4');
    if (s < 120) return wt('wizard.ai.schedule.5');
    return wt('wizard.ai.slow');
  }
  // Chat refinements are shorter prompts → quicker stages.
  if (s < 2) return wt('wizard.ai.chat.1');
  if (s < 8)
    return stage === 'chat-schedule' ? wt('wizard.ai.chat.dates') : wt('wizard.ai.chat.plan');
  if (s < 20) return wt('wizard.ai.chat.3');
  if (s < 45) return wt('wizard.ai.chat.4');
  return wt('wizard.ai.chat.5');
}

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

/** For a crop sown by area (#555) `area` formats the engine's square feet,
 *  so no chip or tip calls them plants. */
export function sufficiencyChip(
  s: SufficiencyResult,
  area?: (sqft: number) => string
): {
  label: string;
  cls: string;
  tooltip: string;
} {
  const pct = Math.round(s.utilizationPct * 100);
  if (area) {
    const available = area(s.plantsAvailable);
    const fit = area(s.plantsFit);
    if (s.status === 'match') {
      return {
        label: wt('wizard.suff.fills', { pct }),
        cls: 'chip-match',
        tooltip: wt('wizard.suff.fillsTipArea', { available, fit })
      };
    }
    if (s.status === 'surplus') {
      const n = area(s.leftoverPlants);
      return {
        label: wt('wizard.suff.extraArea', { n }),
        cls: 'chip-surplus',
        tooltip: wt('wizard.suff.extraTipArea', { available, fit, n })
      };
    }
    return {
      label: wt('wizard.suff.deficit', { pct }),
      cls: 'chip-deficit',
      tooltip: wt('wizard.suff.deficitTipArea', { available, pct, fit })
    };
  }
  if (s.status === 'match') {
    return {
      label: wt('wizard.suff.fills', { pct }),
      cls: 'chip-match',
      tooltip: wt('wizard.suff.fillsTip', {
        available: num(s.plantsAvailable),
        fit: num(s.plantsFit)
      })
    };
  }
  if (s.status === 'surplus') {
    return {
      label: wt('wizard.suff.extra', { n: num(s.leftoverPlants) }),
      cls: 'chip-surplus',
      tooltip: wt('wizard.suff.extraTip', {
        available: num(s.plantsAvailable),
        fit: num(s.plantsFit),
        n: num(s.leftoverPlants)
      })
    };
  }
  return {
    label: wt('wizard.suff.deficit', { pct }),
    cls: 'chip-deficit',
    tooltip: wt('wizard.suff.deficitTip', {
      available: num(s.plantsAvailable),
      pct,
      fit: num(s.plantsFit)
    })
  };
}
