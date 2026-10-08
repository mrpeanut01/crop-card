<script lang="ts">
  import { Apple } from 'lucide-svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererProps } from './types';
  import UnitInput from '$lib/components/ui/UnitInput.svelte';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { fmtQtyRange, usText } from './format';
  import { parseDecimal } from '$lib/harvest/details';

  const props: RendererProps = $props();
  const tr = $derived(createT(page.data?.locale));

  const priorPicks = $derived(props.rendererData?.priorPickCount ?? 0);
  const visitNumber = $derived(priorPicks + 1);

  let pickLb = $state<number | null>(null);
  let gradePct = $state('');

  async function handleCommit(input: {
    quantity?: string;
    lotNumber?: string;
  }): Promise<string | null> {
    const quantity = usText(pickLb) ? `${usText(pickLb)} lb` : input.quantity;
    return props.onCommit({
      quantity,
      lotNumber: input.lotNumber || undefined,
      details: { pickNumber: visitNumber, marketablePct: parseDecimal(gradePct) }
    });
  }
</script>

<div class="cont-renderer">
  <header class="archetype-head">
    <Apple size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name"
        >{props.formVariant === 'berry'
          ? tr('harvestui.r.berry.name')
          : tr('harvestui.r.cont.name')}</span
      >
      <span class="archetype-sub">
        {props.formVariant === 'berry'
          ? tr('harvestui.r.berry.sub', { n: visitNumber })
          : tr('harvestui.r.cont.sub', { n: visitNumber })}
      </span>
    </div>
  </header>

  <div class="pick-block">
    <span class="block-title">{tr('harvestui.r.cont.block')}</span>
    <div class="pick-grid">
      <label class="qfield">
        <span>{tr('harvestui.r.cont.weight', { unit: fmt.unit('weight') })}</span>
        <UnitInput
          quantity="weight"
          suffix={false}
          placeholder={fmt.qty(12, 'weight', { bare: true })}
          bind:value={pickLb}
        />
      </label>
      <label class="qfield">
        <span>{tr('harvestui.r.cont.marketable')}</span>
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
</style>
