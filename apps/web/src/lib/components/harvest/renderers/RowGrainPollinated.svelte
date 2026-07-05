<script lang="ts">
  import { Wheat } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererProps } from './types';

  const props: RendererProps = $props();

  let bushels = $state('');
  let moisturePct = $state('');
  let testWeight = $state('');
  let earCount = $state('');

  async function handleCommit(input: {
    quantity?: string;
    lotNumber?: string;
  }): Promise<string | null> {
    const tagBits: string[] = [];
    if (moisturePct.trim()) tagBits.push(`moisture=${moisturePct}%`);
    if (testWeight.trim()) tagBits.push(`testWt=${testWeight} lb/bu`);
    if (earCount.trim()) tagBits.push(`ears=${earCount}`);
    const quantity = bushels.trim() ? `${bushels} bu` : input.quantity;
    const lot = [input.lotNumber, tagBits.join(' / ')].filter(Boolean).join(' · ').trim();
    // #322 — moisture also travels as a structured number so the kernel gate is reachable.
    const moisture = parseFloat(moisturePct);
    return props.onCommit({
      quantity,
      lotNumber: lot || undefined,
      moisturePct: Number.isFinite(moisture) ? moisture : undefined
    });
  }
</script>

<div class="corn-renderer">
  <header class="archetype-head">
    <Wheat size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Row-grain harvest</span>
      <span class="archetype-sub">
        Wind-pollinated. Sweet corn at R3 (milk); dent / popcorn at R6 (black layer + dry-down).
      </span>
    </div>
  </header>

  <div class="grain-block">
    <span class="block-title">Yield + grain quality</span>
    <div class="grain-grid">
      <label class="qfield">
        <span>Bushels</span>
        <input type="text" inputmode="decimal" placeholder="120" bind:value={bushels} />
      </label>
      <label class="qfield">
        <span>Moisture (%)</span>
        <input type="text" inputmode="decimal" placeholder="15.5" bind:value={moisturePct} />
      </label>
      <label class="qfield">
        <span>Test weight (lb/bu)</span>
        <input type="text" inputmode="decimal" placeholder="56" bind:value={testWeight} />
      </label>
      <label class="qfield">
        <span>Ear count</span>
        <input type="text" inputmode="numeric" placeholder="optional" bind:value={earCount} />
      </label>
    </div>
    <p class="hint">
      Storage moisture targets: dent/feed corn &lt;15%, food-grade dent &lt;14%, sweet flash-frozen
      &lt;76% kernel moisture.
    </p>
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
  .corn-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(212, 167, 92, 0.18);
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
  .grain-block {
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
  .grain-grid {
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
  .hint {
    margin: 8px 0 0;
    font-size: 11.5px;
    color: var(--color-ink-soft);
    line-height: 1.4;
  }
</style>
