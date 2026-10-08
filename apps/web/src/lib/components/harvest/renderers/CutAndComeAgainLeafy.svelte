<script lang="ts">
  import { parseDecimal } from '$lib/harvest/details';
  import { Leaf } from 'lucide-svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererProps } from './types';
  import UnitInput from '$lib/components/ui/UnitInput.svelte';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { fmtQtyRange, usText } from './format';

  const props: RendererProps = $props();
  const tr = $derived(createT(page.data?.locale));

  const priorPicks = $derived(props.rendererData?.priorPickCount ?? 0);
  const cutNumber = $derived(priorPicks + 1);

  let cutLb = $state<number | null>(null);
  let cutHeightInches = $state<number | null>(null);
  let boltObserved = $state(false);

  async function handleCommit(input: {
    quantity?: string;
    lotNumber?: string;
  }): Promise<string | null> {
    const quantity = usText(cutLb) ? `${usText(cutLb)} lb` : input.quantity;
    return props.onCommit({
      quantity,
      lotNumber: input.lotNumber || undefined,
      details: {
        cutNumber,
        cutHeightIn: parseDecimal(usText(cutHeightInches)),
        boltObserved
      }
    });
  }
</script>

<div class="leafy-renderer">
  <header class="archetype-head">
    <Leaf size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">{tr('harvestui.r.leafy.name')}</span>
      <span class="archetype-sub">
        {tr('harvestui.r.leafy.sub', {
          n: cutNumber,
          range: fmtQtyRange(1, 2, 'length', currentPrefs())
        })}
      </span>
    </div>
  </header>

  <div class="cut-block">
    <span class="block-title">{tr('harvestui.r.leafy.block')}</span>
    <div class="cut-grid">
      <label class="qfield">
        <span>{tr('harvestui.r.leafy.weight', { unit: fmt.unit('weight') })}</span>
        <UnitInput
          quantity="weight"
          suffix={false}
          placeholder={fmt.qty(3.5, 'weight', { bare: true, digits: 1 })}
          bind:value={cutLb}
        />
      </label>
      <label class="qfield">
        <span>{tr('harvestui.r.leafy.height', { unit: fmt.unit('length') })}</span>
        <UnitInput
          quantity="length"
          suffix={false}
          placeholder={fmt.qty(1.5, 'length', { bare: true })}
          bind:value={cutHeightInches}
        />
      </label>
    </div>
    <label class="bolt-check">
      <input type="checkbox" bind:checked={boltObserved} />
      {tr('harvestui.r.leafy.bolt')}
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
  .qfield :global(input) {
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
