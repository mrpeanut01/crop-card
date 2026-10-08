<script lang="ts">
  import { archetypeLabel } from '$lib/plugins/familyLabel';
  /**
   * Sprint 7 / Phase 27C (#257) — seed detail.
   *
   * Two-column per INVENTORY_UNIFICATION.md §02:
   *   Left  — variety provenance · germination & treatment · planting parameters
   *   Right — on hand (0-lot empty state) · saving history · linked planting
   *
   * "Linked planting" is a deferred Phase 28 feature — the seed → planting
   * back-reference will land when the wizard's commit step persists
   * `stock_item_id` on the planting row. For Sprint 7 we surface the
   * placeholder + an arrow to the planning wizard.
   */
  import { createT } from '$lib/i18n';
  import { movementReasonText } from '$lib/stock/animalStock';
  import { page } from '$app/state';
  import { cropDisplayName } from '$lib/i18n/cropName';
  import InvSection from '../InvSection.svelte';
  import InvKVP from '../InvKVP.svelte';
  import LotQuantities from '../LotQuantities.svelte';
  import SeedSourcingSection from '../SeedSourcingSection.svelte';
  import { NOP_RULES, seedSourcingLine } from '$lib/organic/nopRules';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { formatStockQuantity } from '$lib/stock/units';
  import type { SeedDetailPayload } from '../../../../routes/inventory/[type]/[id]/+page.server';

  type Props = Omit<
    SeedDetailPayload,
    'type' | 'seedSourcing' | 'showSeedSourcing' | 'canEditSeedSourcing'
  > &
    Partial<Pick<SeedDetailPayload, 'seedSourcing' | 'showSeedSourcing' | 'canEditSeedSourcing'>>;
  const {
    item,
    lots,
    movements,
    plugin,
    seedSourcing = {},
    showSeedSourcing = false,
    canEditSeedSourcing = false
  }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const stockQty = (v: number, digits?: number) =>
    formatStockQuantity(v, item.defaultUnit, currentPrefs(), { digits, category: item.category });
</script>

<header class="detail-header">
  <div>
    <span class="kicker"
      >{tr('inv.seed.kicker', { family: plugin?.cropFamily ?? tr('inv.seed.unknownFamily') })}</span
    >
    <h1 class="serif">{item.displayName}</h1>
    {#if plugin?.daysToMaturity}
      <p class="sub">
        <span class="mono">{plugin.daysToMaturity.min}–{plugin.daysToMaturity.max} d</span>
        {tr('inv.seed.toMaturity')}
      </p>
    {/if}
  </div>
  <a class="edit-cta" href="/inventory/seed/{item.id}/edit">{tr('inv.edit')}</a>
</header>

<div class="detail-grid">
  <div class="col">
    <InvSection title={tr('inv.seed.cropCategory')} kicker={tr('inv.seed.linked')}>
      {#if plugin}
        <InvKVP
          label={tr('inv.seed.category')}
          value={cropDisplayName(plugin.pluginId, plugin.displayName, page.data?.locale)}
        />
        <InvKVP label={tr('inv.seed.cropFamily')} value={plugin.cropFamily ?? '—'} />
        <InvKVP
          label={tr('inv.seed.archetype')}
          value={plugin.archetype ? archetypeLabel(plugin.archetype, page.data?.locale) : '—'}
          tone="locked"
        />
        <p class="cta-row">
          <a href="/inventory/crop/{encodeURIComponent(plugin.pluginId)}"
            >{tr('inv.seed.openCrop')}</a
          >
        </p>
      {:else}
        <p class="empty">
          {tr('inv.seed.noCategory')}
        </p>
      {/if}
    </InvSection>

    <InvSection
      title={item.defaultUnit === 'plants' ? tr('inv.seed.plantStock') : tr('inv.seed.germination')}
      kicker={tr('inv.seed.atSourcing')}
    >
      <InvKVP label={tr('inv.seed.notes')} value={item.notes ?? '—'} />
    </InvSection>

    <InvSection title={tr('inv.seed.plantingParams')} kicker={tr('inv.seed.fromCategory')}>
      {#if plugin?.daysToMaturity}
        <InvKVP
          label={tr('inv.seed.daysToMaturity')}
          value={`${plugin.daysToMaturity.min}–${plugin.daysToMaturity.max} d`}
        />
      {/if}
    </InvSection>
  </div>

  <div class="col">
    <InvSection title={tr('inv.seed.quantity')} kicker={tr('inv.seed.quantityKicker')}>
      <LotQuantities itemId={item.id} unit={item.defaultUnit} category={item.category} {lots} />
    </InvSection>

    {#if showSeedSourcing}
      <InvSection title={tr('stockui.seedsrc.title')} kicker={tr('stockui.seedsrc.kicker')}>
        <p class="rule-line" data-testid="seed-sourcing-rule">
          {seedSourcingLine(NOP_RULES, page.data?.locale)}
        </p>
        {#if lots.length === 0}
          <p class="empty">{tr('stockui.seedsrc.noLots')}</p>
        {:else}
          {#each lots as lot (lot.id)}
            {@const s = seedSourcing[lot.id]}
            {#if s}
              <SeedSourcingSection
                itemId={item.id}
                {lot}
                sourcing={s}
                canEdit={canEditSeedSourcing}
              />
            {/if}
          {/each}
        {/if}
      </InvSection>
    {/if}

    <InvSection title={tr('inv.seed.history')} kicker={tr('inv.seed.last8')}>
      {#if movements.length === 0}
        <p class="empty">{tr('inv.seed.noSowing')}</p>
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

    <InvSection title={tr('inv.seed.linkedPlantings')} kicker={tr('inv.seed.deferred')}>
      <p class="empty small">
        {tr('inv.seed.linkageNote')}
      </p>
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
  .cta-row {
    margin: 6px 0 0;
  }
  .cta-row a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest, #1f5e3a);
    font-weight: 600;
  }
  .rule-line {
    margin: 0 0 10px;
    font-size: 0.9rem;
    color: var(--color-ink-muted, #6a6f63);
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
