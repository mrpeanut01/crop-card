<script lang="ts">
  import { Wheat } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererData } from '../HarvestRouter.svelte';

  /**
   * Sprint 9 / Phase 27E — small-grain Zadoks renderer.
   *
   * Cereal grains (wheat, barley, oats, rye, broomcorn). Single-event
   * harvest at Zadoks Z89 (full ripeness, ~12-14% grain moisture for
   * malt barley, 13.5% for wheat).
   *
   * Enrichment reads `zadoksStages` + `moistureGates` from the plugin so
   * the operator sees:
   *   • where this planting is in the Zadoks staging table relative to
   *     days-from-planting (current/imminent stage highlighted)
   *   • declared moisture danger thresholds before binning (>14% wheat,
   *     >13% barley = storage spoilage risk)
   *
   * Z80-Z99 (ripening) are flagged as harvest-window stages.
   */

  interface Props {
    plantingId: string;
    blockId: string;
    blockName: string;
    cropPluginId: string;
    varietyDisplayName: string;
    cropFamily?: string;
    plantingDate: number | null;
    windowStartMs?: number;
    windowEndMs?: number;
    harvestIndicators: string[];
    onCommit: (input: { quantity?: string; lotNumber?: string }) => Promise<string | null>;
    error?: string | null;
    onCancel: () => void;
    rendererData?: RendererData;
  }

  const props: Props = $props();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const zadoks = $derived(props.rendererData?.zadoksStages);
  const moistureGates = $derived(props.rendererData?.moistureGates ?? []);

  const daysFromPlanting = $derived(
    props.plantingDate ? Math.floor((Date.now() - props.plantingDate) / DAY_MS) : null
  );

  /** Stage the planting is *currently* in (its daysFromPlanting band contains today). */
  const currentStage = $derived.by(() => {
    if (!zadoks || daysFromPlanting === null) return null;
    return (
      zadoks.find(
        (s) =>
          daysFromPlanting >= s.daysFromPlanting.min && daysFromPlanting <= s.daysFromPlanting.max
      ) ?? null
    );
  });
</script>

<div class="grain-renderer">
  <header class="archetype-head">
    <Wheat size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Small-grain harvest</span>
      <span class="archetype-sub">
        Single cut at Z89 (full ripeness). Check moisture before binning.
      </span>
    </div>
  </header>

  {#if zadoks && zadoks.length > 0}
    <div class="zadoks-block">
      <div class="block-head">
        <span class="block-title">Zadoks staging</span>
        {#if daysFromPlanting !== null}
          <span class="mono muted">day {daysFromPlanting} since planting</span>
        {/if}
      </div>
      <ol class="stage-list">
        {#each zadoks as s (s.stage)}
          {@const isCurrent = currentStage?.stage === s.stage}
          {@const isHarvest = /Z8[0-9]|Z9[0-9]/.test(s.stage)}
          <li class:current={isCurrent} class:harvest={isHarvest}>
            <span class="stage-code mono">{s.stage}</span>
            <span class="stage-name">{s.name}</span>
            <span class="stage-days mono muted">
              {s.daysFromPlanting.min === s.daysFromPlanting.max
                ? `d${s.daysFromPlanting.min}`
                : `d${s.daysFromPlanting.min}–${s.daysFromPlanting.max}`}
            </span>
          </li>
        {/each}
      </ol>
    </div>
  {/if}

  {#if moistureGates.length > 0}
    <div class="moisture-gates">
      <span class="block-title">Moisture gates</span>
      <ul>
        {#each moistureGates as g, i (i)}
          {@const t = g.thresholds}
          <li>
            <span class="op">{g.operation}</span>
            <span class="thresh mono">
              {#if t.dangerAbovePct != null}
                STOP &gt;{t.dangerAbovePct}%
              {:else if t.warnAbovePct != null}
                warn &gt;{t.warnAbovePct}%
              {/if}
              {#if t.optimumPercent}
                · optimal {t.optimumPercent.min}–{t.optimumPercent.max}%
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <FallbackHarvestRenderer
    plantingId={props.plantingId}
    blockId={props.blockId}
    blockName={props.blockName}
    cropPluginId={props.cropPluginId}
    varietyDisplayName={props.varietyDisplayName}
    cropFamily={props.cropFamily}
    plantingDate={props.plantingDate}
    windowStartMs={props.windowStartMs}
    windowEndMs={props.windowEndMs}
    harvestIndicators={props.harvestIndicators}
    onCommit={props.onCommit}
    error={props.error}
    onCancel={props.onCancel}
  />
</div>

<style>
  .grain-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(212, 167, 92, 0.12);
    border-left: 3px solid var(--color-wheat, #d4a75c);
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: var(--color-wheat, #d4a75c);
    flex-shrink: 0;
    margin-top: 2px;
  }
  .archetype-head > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .archetype-name {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-ink);
  }
  .archetype-sub {
    font-size: 12px;
    color: var(--color-ink-soft);
    line-height: 1.35;
  }
  .zadoks-block,
  .moisture-gates {
    background: var(--color-cream, #fff8e1);
    border-radius: 4px;
    padding: 8px 12px;
    border: 1px solid rgba(212, 167, 92, 0.35);
  }
  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 6px;
  }
  .block-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--color-ink);
  }
  .stage-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 220px;
    overflow-y: auto;
  }
  .stage-list li {
    display: grid;
    grid-template-columns: 60px 1fr auto;
    gap: 8px;
    align-items: baseline;
    font-size: 12px;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .stage-list li.current {
    background: rgba(31, 94, 58, 0.15);
    border-left: 2px solid var(--color-forest, #1f5e3a);
  }
  .stage-list li.harvest {
    color: var(--color-forest-deep, #1f3522);
    font-weight: 600;
  }
  .stage-code {
    font-weight: 600;
  }
  .stage-name {
    color: var(--color-ink);
  }
  .stage-days,
  .muted {
    color: var(--color-ink-soft);
  }
  .moisture-gates ul {
    list-style: none;
    padding: 0;
    margin: 4px 0 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .moisture-gates li {
    display: flex;
    gap: 10px;
    align-items: baseline;
    font-size: 12px;
  }
  .op {
    text-transform: capitalize;
    color: var(--color-ink-soft);
    min-width: 80px;
  }
  .thresh {
    color: var(--color-rust, #a23a3a);
    font-weight: 600;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }
</style>
