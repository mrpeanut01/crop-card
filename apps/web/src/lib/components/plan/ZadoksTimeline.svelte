<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { DecisionKind, SmallGrainStage } from '$lib/plan/smallGrain';
  import { DEFAULT_TIME_ZONE } from '$lib/weather/leafWet';

  interface Props {
    stages: SmallGrainStage[];
    currentIndex: number;
    nowMs: number;
  }

  const { stages, currentIndex, nowMs }: Props = $props();

  const DAY = 24 * 60 * 60 * 1000;

  const DECISION_COPY: Record<DecisionKind, { label: string; detail: string }> = {
    'herbicide-cutoff': {
      label: 'Herbicide cutoff',
      detail:
        'Most POST broadleaf labels (2,4-D, MCPA, dicamba) stop at jointing. A few allow later — check your label.'
    },
    'flag-leaf': {
      label: 'Flag leaf',
      detail: 'Protect the flag leaf: septoria / rust fungicide timing.'
    },
    heading: { label: 'Heading', detail: 'Scout heads; FHB fungicide decision is days away.' },
    'fhb-window': {
      label: 'FHB fungicide window',
      detail:
        'Early anthesis (Z61) to ~6 days after. Triazoles only — no strobilurins after heading.'
    },
    harvest: { label: 'Harvest', detail: 'Combine when grain is hard; bin at ≤ 13.5% moisture.' }
  };

  function fmt(ms: number): string {
    return new Date(ms).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: DEFAULT_TIME_ZONE
    });
  }

  function relative(ms: number): string {
    const d = Math.round((ms - nowMs) / DAY);
    if (d === 0) return 'today';
    if (d > 0) return `in ${d} d`;
    return `${-d} d ago`;
  }

  const current = $derived(currentIndex >= 0 ? stages[currentIndex] : null);
  const next = $derived(stages[currentIndex + 1] ?? null);
  const decisions = $derived(stages.filter((s) => s.decision));
  const sources = $derived(new Set(stages.map((s) => s.provenance)));
</script>

<section class="card" aria-labelledby="zadoks-title" data-testid="zadoks-timeline">
  <header class="head">
    <div>
      <h2 id="zadoks-title" class="serif">Zadoks growth stages</h2>
      <p class="sub">
        {#if current}
          <strong>{current.name}</strong> ({current.code}) since {fmt(current.startMs)}
        {:else if stages.length > 0}
          Not sown yet — first stage {fmt(stages[0].startMs)}
        {/if}
        {#if next}· next: {next.code} {next.name} ~{fmt(next.startMs)}{/if}
      </p>
    </div>
    <div class="prov">
      {#if sources.has('plugin')}
        <Provenance source="plugin" detail="crop plugin stage table" />
      {/if}
      {#if sources.has('fallback')}
        <Provenance source="fallback" detail="typical Mid-Atlantic timing" />
      {/if}
    </div>
  </header>

  <div class="track-wrap">
    <ol class="track" style:--n={stages.length}>
      {#each stages as s, i (s.code)}
        {@const done = i < currentIndex}
        {@const isCurrent = i === currentIndex}
        <li
          class="stage"
          class:done
          class:current={isCurrent}
          class:fhb={s.decision === 'fhb-window'}
          class:harvest={s.decision === 'harvest'}
          aria-current={isCurrent ? 'step' : undefined}
          title="{s.name} ({s.code}) — {fmt(s.startMs)}"
        >
          <span class="dot" aria-hidden="true">
            {#if done}✓{:else if isCurrent}●{:else if s.decision === 'fhb-window'}!{:else if s.decision === 'harvest'}★{/if}
          </span>
          <span class="code mono">{s.code}</span>
          <span class="name">{s.name}</span>
          <span class="when mono">
            {done ? '' : s.provenance === 'fallback' ? '~' : ''}{fmt(s.startMs)}
          </span>
        </li>
      {/each}
    </ol>
  </div>

  {#if decisions.length > 0}
    <ul class="decisions" aria-label="Key decision points">
      {#each decisions as s (s.code)}
        {@const copy = DECISION_COPY[s.decision!]}
        <li class:passed={s.startMs < nowMs && s.decision !== 'fhb-window'}>
          <span class="d-label">{copy.label}</span>
          <span class="d-when mono">{s.code} · ~{fmt(s.startMs)} · {relative(s.startMs)}</span>
          <span class="d-detail">{copy.detail}</span>
        </li>
      {/each}
    </ul>
  {/if}
  {#if sources.has('fallback')}
    <p class="foot">
      "~" dates are typical timings, not a growth-degree model. Confirm stage in the field — dissect
      a main stem for nodes before the herbicide cutoff.
    </p>
  {/if}
</section>

<style>
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 10px);
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    justify-content: space-between;
    align-items: flex-start;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--color-forest-deep);
  }
  .sub {
    margin: 4px 0 0;
    font-size: 0.82rem;
    color: var(--color-ink-soft);
  }
  .prov {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .track-wrap {
    overflow-x: auto;
    padding: 14px 12px 8px;
  }
  .track {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(72px, 1fr));
    position: relative;
  }
  .track::before {
    content: '';
    position: absolute;
    left: 36px;
    right: 36px;
    top: 11px;
    height: 2px;
    background: var(--color-divider);
  }
  .stage {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 2px;
    padding: 0 3px;
  }
  .dot {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 800;
    background: var(--color-paper);
    border: 2px solid var(--color-divider);
    color: var(--color-ink-soft);
    position: relative;
    z-index: 1;
    margin-bottom: 4px;
  }
  .done .dot {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-cream);
  }
  .current .dot {
    background: var(--color-wheat);
    border-color: var(--color-wheat);
    color: var(--color-cream);
    box-shadow: 0 0 0 4px var(--color-wheat-soft, #e8d9b5);
  }
  .fhb:not(.done):not(.current) .dot {
    background: #f1d9ce;
    border-color: var(--color-rust);
    color: var(--color-rust);
  }
  .harvest:not(.done):not(.current) .dot {
    background: var(--color-wheat-soft, #e8d9b5);
    color: var(--color-forest-deep);
  }
  .code {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--color-ink-muted);
  }
  .current .code {
    color: var(--color-forest-deep);
  }
  .name {
    font-size: 0.72rem;
    line-height: 1.25;
    color: var(--color-ink-soft);
  }
  .when {
    font-size: 0.68rem;
    color: var(--color-ink-muted);
  }
  .decisions {
    list-style: none;
    margin: 0;
    padding: 8px 16px 12px;
    display: grid;
    gap: 8px;
    border-top: 1px dashed var(--color-divider);
  }
  .decisions li {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    padding: 8px 10px;
    border-left: 3px solid var(--color-wheat);
    background: var(--color-cream);
    border-radius: 4px;
  }
  .decisions li.passed {
    border-left-color: var(--color-divider);
    opacity: 0.8;
  }
  .d-label {
    font-weight: 700;
    font-size: 0.88rem;
    color: var(--color-ink);
  }
  .d-when {
    font-size: 0.78rem;
    color: var(--color-ink-soft);
  }
  .d-detail {
    font-size: 0.8rem;
    color: var(--color-ink-soft);
    line-height: 1.4;
  }
  .foot {
    margin: 0;
    padding: 0 16px 12px;
    font-size: 0.75rem;
    color: var(--color-ink-muted);
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }
  @media (min-width: 720px) {
    .decisions {
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    }
  }
</style>
