<script lang="ts">
  import { getWizardContext } from '../wizardState.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { fromDisplay, toDisplay } from '$lib/prefs';
  import { sowMethods } from '$lib/plan/spacingModel';
  import { areaText, sowMethodLabel } from '$lib/plan/seedAmountText';

  /** #555: the Plants cell for a crop sown by area. It shows the ground the
   *  seed covers (never a plant count), the Drilled / Broadcast toggle when
   *  the plugin has both rates, and "Type yours" when no rate is known. */
  const {
    stockItemId,
    cropPluginId,
    quantity,
    checked
  }: { stockItemId: string; cropPluginId: string; quantity: number; checked: boolean } = $props();

  const w = getWizardContext();
  const tr = $derived(createT(page.data?.locale));
  const units = $derived(w.prefs.units);
  const model = $derived(w.spacingFor(cropPluginId));
  const methods = $derived(sowMethods(model));
  const method = $derived(w.sowMethodFor(cropPluginId));
  const manual = $derived(w.manualRateFor(cropPluginId));
  const area = $derived(quantity > 0 ? w.areaFor(stockItemId, quantity) : null);
  const known = $derived(methods.length > 0);
  let typing = $state(false);
  const showRate = $derived(typing || manual !== null);

  function onRate(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    w.setManualRate(cropPluginId, v > 0 ? fromDisplay(v, 'weightPerArea', { units }) : null);
  }
</script>

<div class="area-cell" data-testid="area-seed-cell">
  <span class="area-label">{tr('plan.area.label')}</span>
  {#if methods.length > 1}
    <div class="sow-toggle" role="group" aria-label={tr('plan.area.methodToggle')}>
      {#each methods as m (m)}
        <button
          type="button"
          class:active={m === method}
          aria-pressed={m === method}
          disabled={!checked}
          data-testid={`sow-${m}`}
          onclick={() => w.setSowMethod(cropPluginId, m)}
          >{sowMethodLabel(m, page.data?.locale)}</button
        >
      {/each}
    </div>
  {:else if method}
    <span class="sow-one">{sowMethodLabel(method, page.data?.locale)}</span>
  {/if}
  {#if area}
    <span class="area-covers" data-testid="area-covers">
      <Provenance source={area.provenance} compact />
      {area.provenance === 'manual'
        ? tr('plan.area.coversManual', { area: areaText(area.sqft, units) })
        : tr('plan.area.covers', { area: areaText(area.sqft, units) })}
    </span>
  {:else if checked}
    <span class="area-unknown" data-testid="area-not-known">
      {known ? tr('plan.area.sizedToBed') : tr('plan.area.notKnown')}
    </span>
  {/if}
  {#if checked && (area === null || manual !== null)}
    {#if showRate}
      <label class="rate">
        <span>{units === 'metric' ? tr('plan.area.yourRateMetric') : tr('plan.area.yourRate')}</span
        >
        <input
          type="number"
          min="0"
          step="1"
          data-testid="area-manual-rate"
          value={manual !== null ? Math.round(toDisplay(manual, 'weightPerArea', { units })) : ''}
          oninput={onRate}
        />
        <Provenance source="manual" compact />
        {#if manual !== null}
          <button
            type="button"
            class="link"
            onclick={() => {
              w.setManualRate(cropPluginId, null);
              typing = false;
            }}>{tr('plan.area.clearRate')}</button
          >
        {/if}
      </label>
    {:else}
      <button
        type="button"
        class="link"
        data-testid="area-type-yours"
        onclick={() => (typing = true)}>{tr('plan.area.typeYours')}</button
      >
    {/if}
  {/if}
</div>

<style>
  .area-cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .area-label {
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
  }
  .sow-toggle {
    display: inline-flex;
    gap: 0.25rem;
  }
  .sow-toggle button {
    min-height: 48px;
    min-width: 48px;
    padding: 0 0.75rem;
    border: 1px solid var(--color-forest-deep, #1f3522);
    background: #fff;
    border-radius: 6px;
    color: var(--color-forest-deep, #1f3522);
  }
  .sow-toggle button.active {
    background: var(--color-forest-deep, #1f3522);
    color: #fff;
  }
  .area-covers,
  .area-unknown {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .area-unknown {
    color: #7a3f22;
  }
  .rate {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .rate input {
    width: 6rem;
    min-height: 48px;
  }
  .link {
    min-height: 48px;
    background: none;
    border: none;
    padding: 0;
    color: var(--color-forest-deep, #1f3522);
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
  }
</style>
