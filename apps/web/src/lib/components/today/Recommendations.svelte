<script lang="ts">
  /**
   * Phase 25e (#97) — /today recommendations card with AI-on / AI-off
   * variant per the v2 AI-provenance addendum.
   *
   * 1:1 port of the recommendations card in
   * [`direction-almanac-today.jsx`](../../../../docs/design/almanac/direction-almanac-today.jsx)
   * (lines 353–375). AI-on label: "Recommended · ranked by Claude" with a
   * Provenance(ai, confidence) badge. AI-off label: "Recommended · plugin
   * defaults" with a Provenance(fallback) badge, same items in plugin order.
   *
   * Items come from the loader's upcoming-events list (calendar-engine
   * derived). We surface the first 2 + a "see all N" link.
   */
  import Card from '$lib/components/ui/Card.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';

  export interface RecommendationItem {
    id: string;
    title: string;
    crop?: string;
    window: string;
  }

  interface Props {
    aiEnabled: boolean;
    items: RecommendationItem[];
    /** Pass through from the loader's existing AI confidence; defaults to 0.86
     *  when not available, to match the design mockup's example value. */
    aiConfidence?: number;
  }
  const { aiEnabled, items, aiConfidence = 0.86 }: Props = $props();

  const visible = $derived(items.slice(0, 2));
  const remaining = $derived(Math.max(0, items.length - visible.length));
</script>

<Card>
  <div class="head">
    <span
      title={aiEnabled
        ? 'When AI is on, the top section ranks these by your fertility + scout history. Without a key, you see the same items in plugin-default order.'
        : 'AI key not set — listed in plugin-default order. Add a key in Settings → AI to get personalised ranking.'}
    >
      <Kicker>
        {aiEnabled ? 'Recommended · ranked by Claude' : 'Recommended · plugin defaults'}
      </Kicker>
    </span>
    {#if remaining > 0}
      <a class="see-all" href="/plan">See all {items.length} →</a>
    {/if}
  </div>
  <div class="prov-row">
    {#if aiEnabled}
      <Provenance source="ai" confidence={aiConfidence} />
    {:else}
      <Provenance source="fallback" detail="AI off — using plugin order" />
    {/if}
    <Provenance source="plugin" detail="crop guides + companion library" compact />
  </div>
  {#if visible.length === 0}
    <div class="empty">No recommendations in the next 2 weeks. Add a planting or run a wizard pass.</div>
  {:else}
    {#each visible as s (s.id)}
      <div class="item">
        <div class="title">{s.title}</div>
        <div class="meta">
          {#if s.crop}{s.crop} · {/if}<span class="mono">{s.window}</span>
        </div>
        <button type="button" class="schedule">+ Schedule task</button>
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
  .prov-row {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
    flex-wrap: wrap;
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
