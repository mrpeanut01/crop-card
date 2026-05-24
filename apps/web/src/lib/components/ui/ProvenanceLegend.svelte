<script lang="ts">
  /**
   * Phase 25 v2-addendum stub (#90, fully implemented in #89).
   *
   * Horizontal legend strip for screens that mix provenance sources —
   * Today recommendations, every Spray flow, Plan v2, Wizard schedule.
   * Mirrors `A_ProvenanceLegend` in
   * `docs/design/almanac/direction-almanac-ai-provenance.jsx`.
   *
   * Prop contract:
   *   shown: which sources to surface (caller decides — typically
   *          `aiEnabled ? ['plugin','data','ai','manual']
   *                     : ['plugin','data','fallback','manual']`)
   *   note:  optional right-aligned italic context line
   */

  type ProvenanceSource = 'plugin' | 'data' | 'ai' | 'manual' | 'fallback';

  interface Props {
    shown?: ProvenanceSource[];
    note?: string;
  }

  const { shown = ['plugin', 'data', 'ai', 'manual'], note }: Props = $props();

  const META: Record<ProvenanceSource, { label: string; swatch: string }> = {
    plugin: { label: 'Plugin', swatch: 'var(--color-forest)' },
    data: { label: 'Your data', swatch: 'var(--color-sky)' },
    ai: { label: 'AI', swatch: 'var(--color-wheat)' },
    manual: { label: 'You typed', swatch: 'var(--pill-neutral-fg)' },
    fallback: { label: 'Fallback', swatch: 'var(--color-rust)' }
  };
</script>

<div class="legend">
  <span class="title">Where this data came from</span>
  <span class="rule" aria-hidden="true"></span>
  {#each shown as src (src)}
    {@const m = META[src]}
    <span class="item">
      <span class="swatch" style:background={m.swatch} aria-hidden="true"></span>
      <span>{m.label}</span>
    </span>
  {/each}
  {#if note}<span class="note">{note}</span>{/if}
</div>

<style>
  .legend {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding: 8px 14px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-card, 8px);
    font-size: 11.5px;
    color: var(--color-ink-muted);
  }
  .title {
    font-size: 10px;
    font-weight: 700;
    color: var(--color-ink-soft);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .rule {
    width: 1px;
    height: 14px;
    background: var(--color-divider);
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--color-ink);
  }
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 99px;
  }
  .note {
    margin-left: auto;
    color: var(--color-ink-muted);
    font-style: italic;
  }
</style>
