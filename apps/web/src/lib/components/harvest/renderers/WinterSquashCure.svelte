<script lang="ts">
  import { Package } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererProps } from './types';

  const props: RendererProps = $props();

  let fruitCount = $state('');
  let totalLb = $state('');
  let cureStart = $state('');

  async function handleCommit(input: {
    quantity?: string;
    lotNumber?: string;
  }): Promise<string | null> {
    const tagBits: string[] = [];
    if (fruitCount.trim()) tagBits.push(`fruits=${fruitCount}`);
    if (cureStart.trim()) tagBits.push(`cureStart=${cureStart}`);
    const quantity = totalLb.trim() ? `${totalLb} lb` : input.quantity;
    const lot = [input.lotNumber, tagBits.join(' / ')].filter(Boolean).join(' · ').trim();
    return props.onCommit({ quantity, lotNumber: lot || undefined });
  }
</script>

<div class="cure-renderer">
  <header class="archetype-head">
    <Package size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Cure-then-store harvest</span>
      <span class="archetype-sub">
        Field-cure 10-14 days at 80-85°F before storing at 50-55°F. Record field-pick weight here;
        log cull + cured weight separately.
      </span>
    </div>
  </header>

  <div class="cure-block">
    <span class="block-title">Field-pick + cure schedule</span>
    <div class="cure-grid">
      <label class="qfield">
        <span>Fruit count</span>
        <input type="text" inputmode="numeric" placeholder="120" bind:value={fruitCount} />
      </label>
      <label class="qfield">
        <span>Total weight (lb)</span>
        <input type="text" inputmode="decimal" placeholder="850" bind:value={totalLb} />
      </label>
      <label class="qfield wide">
        <span>Cure start (date)</span>
        <input type="date" bind:value={cureStart} />
      </label>
    </div>
    <p class="hint">
      Cure 10–14 days at 80–85°F before binning. Stop curing once stems pull dry with a clean
      abscission.
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
  .cure-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(186, 130, 60, 0.14);
    border-left: 3px solid #b86d2e;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #b86d2e;
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
  .cure-block {
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
  .cure-grid {
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
  .hint {
    margin: 8px 0 0;
    font-size: 11.5px;
    color: var(--color-ink-soft);
    line-height: 1.4;
  }
</style>
