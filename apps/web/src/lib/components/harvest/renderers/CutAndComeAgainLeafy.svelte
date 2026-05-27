<script lang="ts">
  import { Leaf } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererProps } from './types';

  const props: RendererProps = $props();

  const priorPicks = $derived(props.rendererData?.priorPickCount ?? 0);
  const cutNumber = $derived(priorPicks + 1);

  let cutLb = $state('');
  let cutHeightInches = $state('');
  let boltObserved = $state(false);

  async function handleCommit(input: {
    quantity?: string;
    lotNumber?: string;
  }): Promise<string | null> {
    const tagBits: string[] = [`cut=${cutNumber}`];
    if (cutHeightInches.trim()) tagBits.push(`cutHeight=${cutHeightInches}"`);
    if (boltObserved) tagBits.push('bolt-observed');
    const quantity = cutLb.trim() ? `${cutLb} lb` : input.quantity;
    const lot = [input.lotNumber, tagBits.join(' / ')].filter(Boolean).join(' · ').trim();
    return props.onCommit({ quantity, lotNumber: lot || undefined });
  }
</script>

<div class="leafy-renderer">
  <header class="archetype-head">
    <Leaf size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Cut-and-come-again harvest</span>
      <span class="archetype-sub">
        Cut {cutNumber}. Cut 1-2" above the growing point so the plant can regrow. Re-harvest in 2-3
        weeks until bolt.
      </span>
    </div>
  </header>

  <div class="cut-block">
    <span class="block-title">This cut</span>
    <div class="cut-grid">
      <label class="qfield">
        <span>Cut weight (lb)</span>
        <input type="text" inputmode="decimal" placeholder="3.5" bind:value={cutLb} />
      </label>
      <label class="qfield">
        <span>Cut height above crown (in)</span>
        <input type="text" inputmode="decimal" placeholder="1.5" bind:value={cutHeightInches} />
      </label>
    </div>
    <label class="bolt-check">
      <input type="checkbox" bind:checked={boltObserved} />
      Bolt observed — plant likely past its regrowth window
    </label>
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
  .leafy-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(141, 174, 138, 0.16);
    border-left: 3px solid #6a9669;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #6a9669;
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
  .cut-block {
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
  .cut-grid {
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
  .bolt-check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    font-size: 12px;
    color: var(--color-ink);
    font-weight: 500;
  }
</style>
