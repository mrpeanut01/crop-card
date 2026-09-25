import type { ProgressStage, SufficiencyResult } from './types';

export function fmtDateMs(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

// ─── AI progress heartbeat ──────────────────────────────────────────────
// Long Sonnet calls (allocator, scheduler, chat refinement) can run 30-120s.
// Without feedback "Generating…" reads as a hang. Stage labels are
// time-windowed narration — not real progress from the server, but plenty
// to communicate "the system is alive and working."
export function aiProgressLabel(stage: ProgressStage, elapsedMs: number): string {
  const s = Math.floor(elapsedMs / 1000);
  if (stage === 'allocate') {
    if (s < 3) return 'Building candidacy matrix…';
    if (s < 12) return 'Asking Claude to allocate seeds across your blocks…';
    if (s < 30) return 'Weighing sun, rotation, companions, and cross-pollination…';
    if (s < 60) return 'Refining placements to maximize spacing…';
    if (s < 120) return 'Still working — complex farms take a minute or two…';
    return 'Almost there — the API is slower than usual right now…';
  }
  if (stage === 'schedule') {
    if (s < 3) return 'Computing planting windows from frost dates and DTM…';
    if (s < 12) return 'Asking Claude to pick planting dates…';
    if (s < 30) return 'Honoring cross-pollination staggers and companion offsets…';
    if (s < 60) return 'Checking succession spacing for fast-growing crops…';
    if (s < 120) return 'Still scheduling — staggers across many varieties take time…';
    return 'Almost there — the API is slower than usual right now…';
  }
  // Chat refinements are shorter prompts → quicker stages.
  if (s < 2) return 'Reading your message…';
  if (s < 8)
    return stage === 'chat-schedule' ? 'Reconsidering the dates…' : 'Reconsidering the plan…';
  if (s < 20) return 'Validating against constraints…';
  if (s < 45) return 'Still thinking — refinement turn taking longer than usual…';
  return 'Almost there…';
}

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

export function sufficiencyChip(s: SufficiencyResult): {
  label: string;
  cls: string;
  tooltip: string;
} {
  const pct = Math.round(s.utilizationPct * 100);
  if (s.status === 'match') {
    return {
      label: `Fills block · ${pct}%`,
      cls: 'chip-match',
      tooltip: `Your seed quantity (${s.plantsAvailable.toLocaleString()} plants) is the right size for this block (fits ${s.plantsFit.toLocaleString()}).`
    };
  }
  if (s.status === 'surplus') {
    return {
      label: `${s.leftoverPlants.toLocaleString()} extra plants`,
      cls: 'chip-surplus',
      tooltip: `You have seed for ${s.plantsAvailable.toLocaleString()} plants but the block only fits ${s.plantsFit.toLocaleString()} — about ${s.leftoverPlants.toLocaleString()} plants worth of seed will be left over.`
    };
  }
  return {
    label: `Only fills ${pct}% of block`,
    cls: 'chip-deficit',
    tooltip: `Your seed quantity (${s.plantsAvailable.toLocaleString()} plants) only covers ${pct}% of the block's capacity (${s.plantsFit.toLocaleString()} plants).`
  };
}
