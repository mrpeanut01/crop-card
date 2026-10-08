<script lang="ts">
  import { parseDecimal } from '$lib/harvest/details';
  import { Grape } from 'lucide-svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererProps } from './types';

  const props: RendererProps = $props();
  const tr = $derived(createT(page.data?.locale));

  let brix = $state('');
  let phReading = $state('');
  let ta = $state('');

  async function handleCommit(input: { quantity?: string; lotNumber?: string }) {
    return props.onCommit({
      quantity: input.quantity,
      lotNumber: input.lotNumber || undefined,
      details: {
        brix: parseDecimal(brix),
        ph: parseDecimal(phReading),
        taGPerL: parseDecimal(ta)
      }
    });
  }
</script>

<div class="vine-renderer">
  <header class="archetype-head">
    <Grape size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">{tr('harvestui.r.vine.name')}</span>
      <span class="archetype-sub">
        {tr('harvestui.r.vine.sub')}
      </span>
    </div>
  </header>

  <div class="quality-block">
    <span class="block-title">{tr('harvestui.r.vine.block')}</span>
    <div class="quality-grid">
      <label class="qfield">
        <span>Brix</span>
        <input
          type="text"
          inputmode="decimal"
          placeholder="22.5°"
          bind:value={brix}
          aria-label={tr('harvestui.r.vine.ariaBrix')}
        />
      </label>
      <label class="qfield">
        <span>pH</span>
        <input
          type="text"
          inputmode="decimal"
          placeholder="3.45"
          bind:value={phReading}
          aria-label={tr('harvestui.r.vine.ariaPh')}
        />
      </label>
      <label class="qfield">
        <span>{tr('harvestui.r.vine.ta')}</span>
        <input
          type="text"
          inputmode="decimal"
          placeholder="6.5"
          bind:value={ta}
          aria-label={tr('harvestui.r.vine.ariaTa')}
        />
      </label>
    </div>
    <p class="hint">
      {tr('harvestui.r.vine.hint')}
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
  .vine-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(126, 78, 138, 0.14);
    border-left: 3px solid #6a3f7d;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #6a3f7d;
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
  .quality-block {
    background: var(--color-cream, #fff8e1);
    border: 1px solid rgba(126, 78, 138, 0.35);
    border-radius: 4px;
    padding: 10px 12px;
  }
  .block-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--color-ink);
  }
  .quality-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin: 8px 0;
  }
  .qfield {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .qfield input {
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 3px;
    padding: 6px 8px;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 13px;
  }
  .qfield input:focus {
    outline: 2px solid #6a3f7d;
    outline-offset: 1px;
  }
  .hint {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--color-ink-soft);
    font-style: italic;
    line-height: 1.3;
  }
  @media (max-width: 480px) {
    .quality-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
