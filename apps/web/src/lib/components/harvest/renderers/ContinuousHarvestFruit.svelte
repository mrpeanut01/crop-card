<script lang="ts">
  import { Apple } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererProps } from './types';

  const props: RendererProps = $props();

  const priorPicks = $derived(props.rendererData?.priorPickCount ?? 0);
  const visitNumber = $derived(priorPicks + 1);

  let pickLb = $state('');
  let gradePct = $state('');

  async function handleCommit(input: {
    quantity?: string;
    lotNumber?: string;
  }): Promise<string | null> {
    const tagBits: string[] = [`pick=${visitNumber}`];
    if (gradePct.trim()) tagBits.push(`grade=${gradePct}%`);
    const quantity = pickLb.trim() ? `${pickLb} lb` : input.quantity;
    const lot = [input.lotNumber, tagBits.join(' / ')].filter(Boolean).join(' · ').trim();
    return props.onCommit({ quantity, lotNumber: lot || undefined });
  }
</script>

<div class="cont-renderer">
  <header class="archetype-head">
    <Apple size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Continuous-bearing harvest</span>
      <span class="archetype-sub">
        Pick {visitNumber}. Plants will keep producing — record this visit's pick; the planting
        stays open until you terminate the row.
      </span>
    </div>
  </header>

  <div class="pick-block">
    <span class="block-title">This pick</span>
    <div class="pick-grid">
      <label class="qfield">
        <span>Pick weight (lb)</span>
        <input type="text" inputmode="decimal" placeholder="12" bind:value={pickLb} />
      </label>
      <label class="qfield">
        <span>Marketable % (optional)</span>
        <input type="text" inputmode="decimal" placeholder="92" bind:value={gradePct} />
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
  .cont-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(186, 75, 56, 0.08);
    border-left: 3px solid var(--color-rust, #ba4b38);
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: var(--color-rust, #ba4b38);
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
  .pick-block {
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
  .pick-grid {
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
</style>
