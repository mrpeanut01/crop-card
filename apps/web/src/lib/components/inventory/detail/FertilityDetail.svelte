<script lang="ts">
  /**
   * Sprint 7 / Phase 27C (#257) — fertility detail.
   *
   * Two-column per INVENTORY_UNIFICATION.md §02:
   *   Left  — guaranteed analysis (NPK bar) · application · nutrient-plan impact
   *   Right — on hand · storage & reorder · application history
   *
   * NPK rendered as a horizontal stack-of-bars so the analyst can eyeball
   * the relative N-P-K ratio at a glance. The numbers shown are the label
   * %s from the plugin's `analysis` field (which is kernel-locked — these
   * come from the registered fertilizer label, not free-form user input).
   */
  import { createT } from '$lib/i18n';
  import {
    organicInputClass,
    organicInputClassLabel,
    type OrganicComplianceFlags
  } from '$lib/organic/inputCompliance';
  import { movementReasonText } from '$lib/stock/animalStock';
  import { page } from '$app/state';
  import InvSection from '../InvSection.svelte';
  import InvKVP from '../InvKVP.svelte';
  import LotQuantities from '../LotQuantities.svelte';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { formatRateText, formatStockQuantity } from '$lib/stock/units';
  import type { FertilityDetailPayload } from '../../../../routes/inventory/[type]/[id]/+page.server';

  type Props = Omit<FertilityDetailPayload, 'type'>;
  const { item, lots, movements, plugin }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const stockQty = (v: number, digits?: number) =>
    formatStockQuantity(v, item.defaultUnit, currentPrefs(), { digits });

  const npk = $derived(plugin?.analysis ?? { n: 0, p: 0, k: 0 });
  const npkMax = $derived(Math.max(npk.n, npk.p, npk.k, 1));
  const flags = $derived(plugin?.complianceFlags as OrganicComplianceFlags | undefined);
</script>

<header class="detail-header">
  <div>
    <span class="kicker">{tr('inv.fert.kicker')}</span>
    <h1 class="serif">{item.displayName}</h1>
    {#if plugin}
      <p class="sub">
        {tr('inv.fert.npkLabel')} <span class="mono">{npk.n}-{npk.p}-{npk.k}</span>
        {#if flags?.omriListed === true}· <span class="omri">OMRI</span>{/if}
      </p>
    {/if}
  </div>
  <a class="edit-cta" href="/inventory/fertility/{item.id}/edit">{tr('inv.edit')}</a>
</header>

<div class="detail-grid">
  <div class="col">
    <InvSection title={tr('inv.fert.analysis')} kicker={tr('inv.fert.label')}>
      {#if !plugin}
        <p class="empty" data-testid="no-product-link">
          {tr('inv.fert.noLabel')}
        </p>
      {/if}
      <div class="npk-bars">
        <div class="npk-row">
          <span class="npk-label">N</span>
          <div class="npk-bar">
            <div class="fill n" style="width: {(npk.n / npkMax) * 100}%"></div>
          </div>
          <span class="npk-val mono">{npk.n}%</span>
        </div>
        <div class="npk-row">
          <span class="npk-label">{tr('inv.fert.p2o5')}</span>
          <div class="npk-bar">
            <div class="fill p" style="width: {(npk.p / npkMax) * 100}%"></div>
          </div>
          <span class="npk-val mono">{npk.p}%</span>
        </div>
        <div class="npk-row">
          <span class="npk-label">{tr('inv.fert.k2o')}</span>
          <div class="npk-bar">
            <div class="fill k" style="width: {(npk.k / npkMax) * 100}%"></div>
          </div>
          <span class="npk-val mono">{npk.k}%</span>
        </div>
      </div>
    </InvSection>

    <InvSection title={tr('inv.fert.application')} kicker={tr('inv.pest.labelDerived')}>
      {#if plugin?.applicationRange}
        <InvKVP
          label={tr('inv.pest.defaultRate')}
          value={formatRateText(
            plugin.applicationRange.amount,
            plugin.applicationRange.unit,
            currentPrefs()
          )}
          tone="mono"
        />
      {:else}
        <p class="empty">{tr('inv.fert.noRange')}</p>
      {/if}
      <InvKVP
        label={tr('inv.fert.approachClass')}
        value={plugin?.organic ? tr('inv.fert.organic') : tr('inv.fert.conventional')}
      />
      {#if plugin}
        <InvKVP
          label={tr('inv.fert.organicUse')}
          value={organicInputClassLabel(
            organicInputClass({ type: 'fertilizer', complianceFlags: flags }),
            page.data?.locale
          )}
        />
        {#if flags?.notes}
          <p class="small" lang="en" data-english-only="regulatory" data-testid="organic-condition">
            {flags.notes}
          </p>
        {/if}
      {/if}
    </InvSection>

    <InvSection title={tr('inv.fert.impact')} kicker="Phase 21b">
      <p class="empty small">
        {tr('inv.fert.impactNote')}
      </p>
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

    <InvSection title={tr('inv.fert.history')} kicker={tr('inv.seed.last8')}>
      {#if movements.length === 0}
        <p class="empty">{tr('inv.fert.noHistory')}</p>
      {:else}
        <ul class="movement-list">
          {#each movements.slice(0, 8) as m (m.id)}
            <li>
              <span class="muted small">{fmt.instant(m.occurredAt, 'date')}</span>
              <span class="mono">{movementReasonText(m.reason, page.data?.locale)}</span>
              <span class={m.delta < 0 ? 'rust' : 'forest'}>
                {m.delta > 0 ? '+' : ''}{stockQty(m.delta)}
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
  .omri {
    color: var(--color-forest, #1f5e3a);
    font-weight: 600;
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
  .npk-bars {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .npk-row {
    display: grid;
    grid-template-columns: 40px 1fr 50px;
    gap: 8px;
    align-items: center;
  }
  .npk-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
  }
  .npk-bar {
    height: 14px;
    background: var(--color-cream, #fff8e1);
    border-radius: 4px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    transition: width 0.2s ease;
  }
  .fill.n {
    background: #4a7c59;
  }
  .fill.p {
    background: #c98a4b;
  }
  .fill.k {
    background: #6a8caf;
  }
  .npk-val {
    text-align: right;
    font-size: 0.85rem;
  }
  .empty {
    color: var(--color-ink-muted, #6a6f63);
    font-style: italic;
    margin: 0;
    font-size: 0.9rem;
  }
  .small {
    font-size: 0.8rem;
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
  .rust {
    color: var(--color-rust, #a23a3a);
  }
  .forest {
    color: var(--color-forest-deep, #1f3522);
  }
</style>
