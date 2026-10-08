<script lang="ts">
  import { parseDecimal } from '$lib/harvest/details';
  import { Zap } from 'lucide-svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererProps } from './types';

  const props: RendererProps = $props();
  const tr = $derived(createT(page.data?.locale));

  type TerminationMethod = '' | 'roller-crimp' | 'mow' | 'mow-flame' | 'burndown' | 'incorporate';
  let method = $state<TerminationMethod>('');
  let residueCoverPct = $state('');
  let biomassEstimate = $state('');

  async function handleCommit(input: {
    quantity?: string;
    lotNumber?: string;
  }): Promise<string | null> {
    const quantity = biomassEstimate.trim() ? `${biomassEstimate} t/ac biomass` : input.quantity;
    return props.onCommit({
      quantity,
      lotNumber: input.lotNumber || undefined,
      details: {
        terminationMethod: method || undefined,
        residueCoverPct: parseDecimal(residueCoverPct)
      }
    });
  }
</script>

<div class="terminate-renderer">
  <header class="archetype-head">
    <Zap size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">{tr('harvestui.r.cover.name')}</span>
      <span class="archetype-sub">
        {tr('harvestui.r.cover.sub')}
      </span>
    </div>
  </header>

  <div class="terminate-block">
    <span class="block-title">{tr('harvestui.r.cover.block')}</span>
    <div class="terminate-grid">
      <label class="qfield wide">
        <span>{tr('harvestui.r.cover.method')}</span>
        <select bind:value={method}>
          <option value="">{tr('harvestui.r.cover.pick')}</option>
          <option value="roller-crimp">{tr('harvestui.r.cover.roller')}</option>
          <option value="mow">{tr('harvestui.r.cover.mow')}</option>
          <option value="mow-flame">{tr('harvestui.r.cover.mowFlame')}</option>
          <option value="burndown">{tr('harvestui.r.cover.burndown')}</option>
          <option value="incorporate">{tr('harvestui.r.cover.incorporate')}</option>
        </select>
      </label>
      <label class="qfield">
        <span>{tr('harvestui.r.cover.residue')}</span>
        <input type="text" inputmode="decimal" placeholder="85" bind:value={residueCoverPct} />
      </label>
      <label class="qfield">
        <span>{tr('harvestui.r.cover.biomass')}</span>
        <input type="text" inputmode="decimal" placeholder="3.5" bind:value={biomassEstimate} />
      </label>
    </div>
  </div>

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
    onCommit={handleCommit}
    error={props.error}
    onCancel={props.onCancel}
  />
</div>

<style>
  .terminate-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(106, 150, 105, 0.14);
    border-left: 3px solid #4f7a4f;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #4f7a4f;
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
  .terminate-block {
    background: var(--color-cream, #fff8e1);
    border-radius: 4px;
    padding: 12px 14px;
  }
  .block-title {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-muted);
    display: block;
    margin-bottom: 8px;
  }
  .terminate-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .qfield {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-ink-muted);
  }
  .qfield.wide {
    grid-column: 1 / -1;
  }
  .qfield input,
  .qfield select {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 14px;
    padding: 8px 10px;
    border: 1px solid var(--color-divider);
    border-radius: 4px;
    background: var(--color-paper);
    color: var(--color-ink);
    min-height: 36px;
  }
</style>
