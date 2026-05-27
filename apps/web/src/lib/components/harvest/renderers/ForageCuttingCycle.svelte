<script lang="ts">
  import { Scissors } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererData } from '../HarvestRouter.svelte';

  /**
   * Sprint 9 / Phase 27E (#230) — forage cutting-cycle renderer.
   *
   * Perennial forage (alfalfa, clover, orchard-grass, timothy). Multi-
   * cut model: typically 2-4 cuttings per season at 28-35 day intervals.
   *
   * The enriched header reads `hayOperations` from the crop plugin and
   * surfaces:
   *   • cutting count (this cut N of declared M)
   *   • days since last cut + days remaining in the regrowth window
   *   • per-bale-type moisture danger thresholds (small-square baled
   *     >22% = mold/fire risk; large-round tolerates higher)
   *
   * The /harvest +page.server.ts also keys the *next* harvest window
   * off the last cut + `hayOperations.cutIntervalDays` once the
   * planting has been mowed at least once.
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

  const hayOps = $derived(props.rendererData?.hayOperations);
  const priorPicks = $derived(props.rendererData?.priorPickCount ?? 0);
  const cuttingsPerSeason = $derived(hayOps?.cuttingsPerSeason);
  const cutInterval = $derived(hayOps?.cutIntervalDays);
  const baleGate = $derived(hayOps?.baleMoistureGate);

  const baleEntries = $derived(
    baleGate ? Object.entries(baleGate).filter(([, v]) => !!v) : []
  );
</script>

<div class="forage-renderer">
  <header class="archetype-head">
    <Scissors size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Forage cutting cycle</span>
      <span class="archetype-sub">
        Multi-cut perennial. Check the 3-day weather window before mowing — wet hay molds in the
        bale.
      </span>
    </div>
  </header>

  <!-- #182 — Forage growers need a path to the dedicated multi-step
       /hay workflow (NOAA dry-window gate, Mow→Ted→Rake→Bale→Store
       sequence, per-block per-year cutting history). The inline form
       below stays for the quick-log path. -->
  <p class="hay-cta">
    <a href="/hay?block={props.blockId}&planting={props.plantingId}">
      Open multi-step hay workflow →
    </a>
  </p>

  {#if cuttingsPerSeason || cutInterval || baleEntries.length > 0}
    <div class="hay-detail">
      {#if cuttingsPerSeason}
        <div class="detail-row">
          <span class="detail-label">Cutting</span>
          <span class="detail-value mono">
            {priorPicks + 1} of {cuttingsPerSeason.min === cuttingsPerSeason.max
              ? cuttingsPerSeason.min
              : `${cuttingsPerSeason.min}-${cuttingsPerSeason.max}`} per season
          </span>
        </div>
      {/if}
      {#if cutInterval}
        <div class="detail-row">
          <span class="detail-label">Cut interval</span>
          <span class="detail-value mono">
            {cutInterval.min === cutInterval.max
              ? `${cutInterval.min} d`
              : `${cutInterval.min}–${cutInterval.max} d`} regrowth window
          </span>
        </div>
      {/if}
      {#if baleEntries.length > 0}
        <div class="moisture-block">
          <span class="detail-label block">Bale moisture danger</span>
          <ul class="moisture-list">
            {#each baleEntries as [baleType, thresholds] (baleType)}
              <li>
                <span class="bale-type">{baleType}</span>
                <span class="threshold mono">
                  {thresholds?.dangerAbovePct != null
                    ? `>${thresholds.dangerAbovePct}% = fire/mold risk`
                    : thresholds?.warnAbovePct != null
                      ? `warn above ${thresholds.warnAbovePct}%`
                      : '—'}
                </span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
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
  .forage-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(44, 82, 55, 0.08);
    border-left: 3px solid var(--color-forest-deep, #2c5237);
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: var(--color-forest-deep, #2c5237);
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
  .hay-detail {
    background: var(--color-cream, #fff8e1);
    border-radius: 4px;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid rgba(44, 82, 55, 0.18);
  }
  .detail-row {
    display: flex;
    gap: 10px;
    align-items: baseline;
    font-size: 12px;
  }
  .detail-label {
    color: var(--color-ink-soft);
    min-width: 120px;
  }
  .detail-label.block {
    display: block;
    margin-bottom: 4px;
  }
  .detail-value {
    color: var(--color-ink);
    font-weight: 600;
  }
  .moisture-block {
    border-top: 1px dashed rgba(44, 82, 55, 0.2);
    padding-top: 6px;
  }
  .moisture-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .moisture-list li {
    display: flex;
    gap: 10px;
    align-items: baseline;
    font-size: 12px;
  }
  .bale-type {
    color: var(--color-ink-soft);
    text-transform: capitalize;
    min-width: 110px;
  }
  .threshold {
    color: var(--color-rust, #a23a3a);
    font-weight: 600;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }
  .hay-cta {
    margin: 0;
    font-size: 13px;
  }
  .hay-cta a {
    color: var(--color-forest-deep, #2c5237);
    text-decoration: none;
    font-weight: 600;
  }
  .hay-cta a:hover {
    text-decoration: underline;
  }
</style>
