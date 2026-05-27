<script lang="ts">
  import { Sprout } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererProps } from './types';

  const props: RendererProps = $props();

  let dryPodLb = $state('');
  let cleanSeedLb = $state('');
  let storageMoisturePct = $state('');

  const moistureWarn = $derived.by(() => {
    const v = parseFloat(storageMoisturePct);
    return Number.isFinite(v) && v > 15;
  });

  async function handleCommit(input: {
    quantity?: string;
    lotNumber?: string;
  }): Promise<string | null> {
    const tagBits: string[] = [];
    if (dryPodLb.trim()) tagBits.push(`pods=${dryPodLb} lb`);
    if (storageMoisturePct.trim()) tagBits.push(`moisture=${storageMoisturePct}%`);
    const quantity = cleanSeedLb.trim() ? `${cleanSeedLb} lb seed` : input.quantity;
    const lot = [input.lotNumber, tagBits.join(' / ')].filter(Boolean).join(' · ').trim();
    return props.onCommit({ quantity, lotNumber: lot || undefined });
  }
</script>

<div class="dry-legume-renderer">
  <header class="archetype-head">
    <Sprout size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Dry-seed legume harvest</span>
      <span class="archetype-sub">
        Threshing pass at full senescence. Test seed moisture (target 13-15%) before storage — wet
        beans heat + rot.
      </span>
    </div>
  </header>

  <div class="bean-block">
    <span class="block-title">Threshing + storage</span>
    <div class="bean-grid">
      <label class="qfield">
        <span>Dry pod weight (lb)</span>
        <input type="text" inputmode="decimal" placeholder="180" bind:value={dryPodLb} />
      </label>
      <label class="qfield">
        <span>Clean seed weight (lb)</span>
        <input type="text" inputmode="decimal" placeholder="120" bind:value={cleanSeedLb} />
      </label>
      <label class="qfield wide">
        <span>Storage moisture (%)</span>
        <input
          type="text"
          inputmode="decimal"
          placeholder="14"
          bind:value={storageMoisturePct}
          class:warn={moistureWarn}
        />
      </label>
    </div>
    {#if moistureWarn}
      <p class="moisture-warn">
        ⚠ Above 15% moisture — beans will heat and rot in the bin. Dry to 13–15% before storage.
      </p>
    {/if}
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
  .dry-legume-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(141, 174, 138, 0.14);
    border-left: 3px solid #8a7860;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #8a7860;
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
  .bean-block {
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
  .bean-grid {
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
  .qfield input {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 14px;
    padding: 8px 10px;
    border: 1px solid var(--color-divider);
    border-radius: 4px;
    background: var(--color-paper);
    color: var(--color-ink);
    min-height: 36px;
  }
  .qfield input.warn {
    border-color: var(--color-rust, #ba4b38);
    background: #fdecea;
  }
  .moisture-warn {
    margin: 8px 0 0;
    color: var(--color-rust, #ba4b38);
    background: #fdecea;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
  }
</style>
