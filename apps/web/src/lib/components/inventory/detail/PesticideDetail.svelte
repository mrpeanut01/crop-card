<script lang="ts">
  /**
   * Sprint 7 / Phase 27C (#257) — pesticide detail.
   *
   * Two-column layout per INVENTORY_UNIFICATION.md §02:
   *   Left  — plugin link · safety kernel info · rate range table
   *   Right — on hand (lots) · storage & reorder · recent usage
   *
   * Kernel-locked fields (EPA reg, REI, PHI) render via `InvKVP tone="locked"`
   * — operator can't edit them here; the proposal flow lives at
   * /settings/plugins/[id]/propose-change (deferred to a later sprint).
   */
  import { createT } from '$lib/i18n';
  import { movementReasonText } from '$lib/stock/animalStock';
  import { page } from '$app/state';
  import InvSection from '../InvSection.svelte';
  import InvKVP from '../InvKVP.svelte';
  import FallbackRateLine from '$lib/components/spray/FallbackRateLine.svelte';
  import CropLabelRates from '$lib/components/spray/CropLabelRates.svelte';
  import { isFallbackRate } from '$lib/plugins/rateProvenance';
  import LotQuantities from '../LotQuantities.svelte';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { formatRateText, formatStockQuantity, perAcreRateUnit } from '$lib/stock/units';
  import { pollinatorLabelText } from '$lib/pollinator/labelText';
  import type { PesticideDetailPayload } from '../../../../routes/inventory/[type]/[id]/+page.server';

  type Props = Omit<PesticideDetailPayload, 'type'>;
  const {
    item,
    lots,
    movements,
    plugin,
    phiByCrop = [],
    rateByCrop = [],
    rateByCropEarlierLabels = []
  }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
  const rateFallback = $derived(isFallbackRate(plugin));
  const phiLongest = $derived(
    Math.max(...phiByCrop.map((r) => r.days), plugin?.preHarvestIntervalDays ?? 0)
  );

  const stockQty = (v: number, digits?: number) =>
    formatStockQuantity(v, item.defaultUnit, currentPrefs(), { digits, labelUnit: true });
</script>

<header class="detail-header">
  <div>
    <span class="kicker">{tr('inv.pest.kicker')}</span>
    <h1 class="serif">{item.displayName}</h1>
    {#if plugin?.activeIngredients?.length}
      <p class="sub">
        {plugin.activeIngredients.map((ai) => ai.name).join(' · ')}
      </p>
    {/if}
  </div>
  <a class="edit-cta" href="/inventory/pesticide/{item.id}/edit">{tr('inv.edit')}</a>
</header>

<div class="detail-grid">
  <div class="col">
    <InvSection title={tr('inv.pest.productLabel')} kicker={tr('inv.pest.library')}>
      {#if plugin}
        <InvKVP label={tr('inv.pest.product')} value={plugin.displayName} />
        <InvKVP label={tr('inv.pest.productId')} value={plugin.pluginId} tone="mono" />
      {:else}
        <p
          class="warn-empty"
          role="note"
          data-testid="no-product-link"
          lang="en"
          data-english-only="safety"
        >
          No product label linked. This item has no EPA registration number, REI, PHI or label rate,
          so the safety checks cannot use its label data. Link the product with Edit.
        </p>
      {/if}
    </InvSection>

    <div lang="en" data-english-only="safety">
      <InvSection title="Safety kernel" kicker="From the product label">
        <InvKVP
          label="EPA reg"
          value={plugin?.epaRegistrationNumber ?? 'Not on file'}
          tone="locked"
        />
        <InvKVP
          label="Re-entry interval"
          value={plugin?.reEntryIntervalHours != null
            ? `${plugin.reEntryIntervalHours} h`
            : 'Not on file. Check the label.'}
          tone="locked"
        />
        {#if phiByCrop.length}
          {#each phiByCrop as row, i (i)}
            <InvKVP
              label={`Pre-harvest interval, ${row.crop}`}
              value={`${row.days} d`}
              tone="locked"
            />
          {/each}
          <p class="phi-note" data-testid="phi-by-crop-note">
            Crops not listed: {phiLongest} d, the longest on file. Check the label.
          </p>
        {:else}
          <InvKVP
            label="Pre-harvest interval"
            value={plugin?.preHarvestIntervalDays != null
              ? `${plugin.preHarvestIntervalDays} d`
              : 'Not on file. Check the label.'}
            tone="locked"
          />
          {#if plugin?.preHarvestIntervalDays != null}
            <p class="phi-note" data-testid="phi-single-note">
              One value on file for every crop. The label may list a longer PHI for your crop.
            </p>
          {/if}
        {/if}
        {#if plugin?.pollinator || plugin?.pollinatorRisk}
          <InvKVP label="Pollinators" value={pollinatorLabelText(plugin)} tone="locked" />
        {/if}
        {#if plugin?.activeIngredients?.length}
          <div class="ai-list">
            {#each plugin.activeIngredients as ai, idx (idx)}
              <span class="ai-chip"
                >{ai.name}{ai.chemistryClass ? ` (${ai.chemistryClass})` : ''}</span
              >
            {/each}
          </div>
        {/if}
      </InvSection>
    </div>

    <InvSection
      title={tr('inv.pest.rate')}
      kicker={rateFallback ? tr('inv.pest.typicalRate') : tr('inv.pest.labelDerived')}
    >
      {#if plugin?.ratePerAcre}
        <InvKVP
          label={tr('inv.pest.defaultRate')}
          value={formatRateText(
            plugin.ratePerAcre.amount,
            perAcreRateUnit(plugin.ratePerAcre.unit),
            currentPrefs(),
            {
              labelUnit: true
            }
          )}
          tone="mono"
        />
        {#if rateFallback}<FallbackRateLine />{/if}
      {:else}
        <p class="empty">{tr('inv.pest.noRate')}</p>
      {/if}
      <CropLabelRates rows={rateByCrop} earlierLabels={rateByCropEarlierLabels} />
    </InvSection>
  </div>

  <div class="col">
    <InvSection title={tr('inv.seed.quantity')} kicker={tr('inv.seed.quantityKicker')}>
      <LotQuantities itemId={item.id} unit={item.defaultUnit} {lots} />
    </InvSection>

    <InvSection title={tr('inv.storageReorder')}>
      <InvKVP
        label={tr('inv.reorderAt')}
        value={item.reorderThreshold != null ? stockQty(item.reorderThreshold, 2) : '—'}
      />
      <InvKVP label={tr('inv.seed.notes')} value={item.notes ?? '—'} />
    </InvSection>

    <InvSection title={tr('inv.recentUsage')} kicker={tr('inv.last25')}>
      {#if movements.length === 0}
        <p class="empty">{tr('inv.noMovements')}</p>
      {:else}
        <ul class="movement-list">
          {#each movements.slice(0, 8) as m (m.id)}
            <li>
              <span class="muted small">{fmt.instant(m.occurredAt, 'date')}</span>
              <span class="mono">{movementReasonText(m.reason, page.data?.locale)}</span>
              <span class={m.delta < 0 ? 'rust' : 'forest'}>
                {m.delta > 0 ? '+' : ''}{m.delta.toFixed(1)}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </InvSection>
  </div>
</div>

<style>
  .detail-header {
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 12px;
  }
  .edit-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    box-sizing: border-box;
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
    padding: 8px 14px;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .edit-cta:hover {
    background: var(--color-forest-deep, #1f3522);
  }
  .kicker {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-ink-muted, #6a6f63);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h1 {
    margin: 2px 0 4px;
    font-size: 1.5rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .sub {
    margin: 0;
    color: var(--color-ink-muted, #6a6f63);
    font-size: 0.9rem;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 14px;
  }
  @media (max-width: 768px) {
    .detail-grid {
      grid-template-columns: 1fr;
    }
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .warn-empty {
    margin: 0;
    padding: 8px 10px;
    border-left: 4px solid var(--color-rust, #a23a3a);
    background: var(--color-rust-tint, #fce8e8);
    color: var(--color-rust, #a23a3a);
    font-size: 0.9rem;
  }
  .phi-note {
    margin: 4px 0 8px;
    font-size: 0.85rem;
    color: var(--color-ink-muted, #6a6f63);
  }
  .empty {
    color: var(--color-ink-muted, #6a6f63);
    font-style: italic;
    margin: 0;
    font-size: 0.9rem;
  }
  .ai-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ai-chip {
    background: var(--color-cream, #fff8e1);
    border-radius: 99px;
    padding: 2px 10px;
    font-size: 0.8rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .movement-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .movement-list li {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.85rem;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }
  .muted {
    color: var(--color-ink-muted, #6a6f63);
  }
  .small {
    font-size: 0.75rem;
  }
  .rust {
    color: var(--color-rust, #a23a3a);
  }
  .forest {
    color: var(--color-forest-deep, #1f3522);
  }
</style>
