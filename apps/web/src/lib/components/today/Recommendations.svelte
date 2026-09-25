<script lang="ts">
  /**
   * Phase 25e (#97) — /today recommendations card.
   *
   * Items come from the loader's upcoming-events list (calendar-engine
   * derived). We surface the first 2 + a "see all N" link.
   */
  import Card from '$lib/components/ui/Card.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';

  export interface RecommendationItem {
    id: string;
    title: string;
    crop?: string;
    window: string;
  }

  interface Props {
    items: RecommendationItem[];
    /** Called when user clicks "+ Schedule task" on a recommendation (#105). */
    onSchedule?: (id: string) => void;
  }
  const { items, onSchedule }: Props = $props();

  const visible = $derived(items.slice(0, 2));
  const remaining = $derived(Math.max(0, items.length - visible.length));
</script>

<Card>
  <div class="head">
    <Kicker>Recommended</Kicker>
    {#if remaining > 0}
      <a class="see-all" href="/plan">See all {items.length} →</a>
    {/if}
  </div>
  {#if visible.length === 0}
    <div class="empty">
      No recommendations in the next 2 weeks. Add a planting or run a wizard pass.
    </div>
  {:else}
    {#each visible as s (s.id)}
      <div class="item">
        <div class="title">{s.title}</div>
        <div class="meta">
          {#if s.crop}{s.crop} ·
          {/if}<span class="mono">{s.window}</span>
        </div>
        {#if onSchedule}
          <button type="button" class="schedule" onclick={() => onSchedule(s.id)}>
            + Schedule task
          </button>
        {/if}
      </div>
    {/each}
  {/if}
</Card>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    gap: 12px;
  }
  .see-all {
    font-size: 12px;
    color: var(--color-forest);
    font-weight: 600;
    text-decoration: none;
  }
  .item {
    padding: 10px 0;
    border-top: 1px dashed var(--color-divider-soft, var(--color-divider));
  }
  .item:first-of-type {
    border-top: none;
  }
  .title {
    font-size: 13.5px;
    color: var(--color-ink);
    font-weight: 500;
  }
  .meta {
    font-size: 12px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .schedule {
    margin-top: 6px;
    background: transparent;
    color: var(--color-forest);
    border: none;
    padding: 0;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .schedule:hover {
    text-decoration: underline;
  }
  .empty {
    font-size: 12.5px;
    color: var(--color-ink-muted);
    padding: 10px 0 2px;
  }
</style>
