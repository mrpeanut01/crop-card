<script lang="ts">
  /**
   * Phase 25e (#97) — /today "do this first" hero card.
   *
   * 1:1 port of the `ATodayScreen` hero in
   * [`direction-almanac-today.jsx`](../../../../docs/design/almanac/direction-almanac-today.jsx)
   * (lines 236–277). Pills + provenance badges + serif action sentence +
   * body + CTA row + scope band.
   *
   * Empty state: when `action` is null, renders a calmer "All caught up"
   * card instead. The user has nothing overdue, nothing scheduled today,
   * and no spray/harvest window opening — the page should not punish
   * them with a forced default action.
   */
  import { ArrowRight, Sparkle, Check } from 'lucide-svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { PriorityAction } from '$lib/today/priorityAction';

  interface Props {
    action: PriorityAction | null;
    aiEnabled: boolean;
  }
  const { action, aiEnabled }: Props = $props();

  /** Tone pill on the hero: chemistry-flavored chip. */
  function toneLabel(tag: PriorityAction['toneTag']): string {
    return {
      scout: 'Scout',
      spray: 'Spray',
      harvest: 'Harvest',
      fertility: 'Fertility',
      planting: 'Plant',
      task: 'Task'
    }[tag];
  }
  function tonePillTone(
    tag: PriorityAction['toneTag']
  ): 'forest' | 'wheat' | 'rust' | 'sky' | 'neutral' {
    return {
      scout: 'forest',
      spray: 'rust',
      harvest: 'wheat',
      fertility: 'wheat',
      planting: 'forest',
      task: 'neutral'
    }[tag] as 'forest' | 'wheat' | 'rust' | 'sky' | 'neutral';
  }
</script>

<Card padded={false}>
  {#if action}
    <div class="hero">
      <div class="hero-head">
        <Pill tone="wheat">Today · do this first</Pill>
        <Pill tone={tonePillTone(action.toneTag)}>{toneLabel(action.toneTag)}</Pill>
        {#if action.overdueDays && action.overdueDays > 0}
          <Pill tone="rust">Overdue · {action.overdueDays}d</Pill>
        {/if}
        <div class="prov-row">
          {#if action.kind === 'task'}
            <Provenance source="data" detail="your tasks" compact />
          {:else}
            <Provenance source="plugin" detail="crop calendar" compact />
          {/if}
        </div>
      </div>
      <h2 class="serif action-title">{action.title}</h2>
      {#if action.body}
        <p class="action-body">{action.body}</p>
      {/if}
      <div class="cta-row">
        <a class="primary" href={action.ctaHref}>
          {action.ctaLabel}
          <ArrowRight size={15} strokeWidth={1.75} />
        </a>
        <button type="button" class="ghost">Skip — note why</button>
        {#if aiEnabled}
          <span class="ai-hint">
            <Sparkle size={12} strokeWidth={1.75} />
            <span>Ask Claude · "Why this? What does done look like?"</span>
          </span>
        {/if}
      </div>
    </div>
    {#if action.scope.length > 0}
      <div class="scope-band">
        {#each action.scope as [k, v] (k)}
          <div class="scope-cell">
            <div class="scope-k">{k}</div>
            <div class="scope-v mono">{v}</div>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="hero empty">
      <div class="empty-icon">
        <Check size={20} strokeWidth={2} />
      </div>
      <h2 class="serif action-title">All caught up.</h2>
      <p class="action-body">
        Nothing's overdue, nothing's scheduled today, and no spray or harvest windows open in the
        next 24 hours. Browse the week strip below for what's coming.
      </p>
    </div>
  {/if}
</Card>

<style>
  .hero {
    padding: 24px 26px 22px;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .hero.empty {
    border-bottom: none;
    text-align: center;
  }
  .empty-icon {
    width: 44px;
    height: 44px;
    border-radius: 999px;
    background: rgba(141, 174, 138, 0.18);
    color: var(--color-forest-deep);
    display: inline-grid;
    place-items: center;
    margin-bottom: 10px;
  }
  .hero-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .prov-row {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .action-title {
    margin: 0;
    font-size: 26px;
    color: var(--color-ink);
    letter-spacing: -0.015em;
    font-family: var(--font-serif, serif);
  }
  .action-body {
    margin: 10px 0 0;
    color: var(--color-ink-soft);
    font-size: 14.5px;
    line-height: 1.55;
    max-width: 620px;
  }
  .empty .action-body {
    margin-left: auto;
    margin-right: auto;
  }
  .cta-row {
    margin-top: 16px;
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border-radius: var(--radius-input, 6px);
    background: var(--color-forest);
    color: var(--color-cream);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-decoration: none;
    font-family: inherit;
    border: none;
    cursor: pointer;
  }
  .primary:hover {
    background: var(--color-forest-deep);
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: var(--radius-input, 6px);
    background: transparent;
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
    font-size: 14px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
  }
  .ai-hint {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    color: var(--color-ink-muted);
  }
  .ai-hint :global(svg) {
    color: var(--color-wheat, #d4a75c);
  }
  .scope-band {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    padding: 14px 26px;
    gap: 18px;
    background: var(--color-wheat-tint, #f4ecd8);
  }
  .scope-k {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 600;
  }
  .scope-v {
    font-size: 13.5px;
    color: var(--color-ink);
    margin-top: 3px;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  @media (max-width: 720px) {
    .hero {
      padding: 18px 18px 16px;
    }
    .scope-band {
      grid-template-columns: 1fr 1fr;
      padding: 12px 18px;
      gap: 12px;
    }
    .ai-hint {
      margin-left: 0;
      width: 100%;
    }
  }
</style>
