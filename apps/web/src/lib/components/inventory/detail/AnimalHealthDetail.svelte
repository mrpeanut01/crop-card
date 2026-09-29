<script lang="ts">
  /**
   * Phase 32D (D4): a medicine, vaccine or dewormer. Withdrawal times show
   * only from the linked animal-health product's label data; a scan never
   * sets them (D0-15). With no link, or no label data, the treatment page
   * treats the withdrawal as unknown until the owner enters it.
   */
  import InvSection from '../InvSection.svelte';
  import InvKVP from '../InvKVP.svelte';
  import LotQuantities from '../LotQuantities.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import { formatStockQuantity } from '$lib/stock/units';
  import { formatNada, movementLabel } from '$lib/stock/animalStock';
  import type { AnimalHealthDetailPayload } from '../../../../routes/inventory/[type]/[id]/+page.server';

  type Props = Omit<AnimalHealthDetailPayload, 'type'>;
  const { item, lots, movements, meta, plugin, speciesNames, canEdit }: Props = $props();

  const qty = (v: number) =>
    formatStockQuantity(v, item?.defaultUnit ?? 'count', currentPrefs(), { digits: 2 });

  const CLASS_LABEL: Record<string, string> = {
    all: 'All',
    'lactating-dairy': 'Lactating dairy',
    'non-lactating-dairy': 'Dry dairy',
    laying: 'Laying',
    'non-laying': 'Not laying',
    'veal-calves': 'Veal calves'
  };

  function withdrawalText(
    w: NonNullable<typeof plugin>['labelUses'][number]['withdrawal']
  ): string {
    if (!w) return 'Not known. Enter it from the label or your vet on the treatment.';
    const parts: string[] = [];
    if (w.meatDays !== undefined) parts.push(`meat ${w.meatDays} d`);
    if (w.milkHours !== undefined) parts.push(`milk ${w.milkHours} h`);
    if (w.eggsDays !== undefined) parts.push(`eggs ${w.eggsDays} d`);
    for (const f of w.doNotUseFor ?? []) parts.push(`not for ${f}`);
    return parts.join(', ');
  }

  const title = $derived(item?.displayName ?? plugin?.displayName ?? '');
</script>

<header class="detail-header">
  <div>
    <span class="kicker">Animal health{item ? '' : ' · library'}</span>
    <h1 class="serif">{title}</h1>
    {#if meta.nada}
      <p class="sub" data-testid="nada">
        <span class="mono">{formatNada(meta.nada)}</span>
        <Provenance source={meta.nada.provenance} compact />
      </p>
    {:else if plugin?.approval}
      <p class="sub"><span class="mono">{plugin.approval.kind} {plugin.approval.number}</span></p>
    {/if}
  </div>
  {#if item && canEdit}
    <a class="edit-cta" href="/inventory/animal-health/{item.id}/edit">Edit</a>
  {/if}
</header>

<div class="detail-grid">
  <div class="col">
    <InvSection title="Withdrawal" kicker="From the label">
      {#if !plugin}
        <p class="note" role="note" data-testid="withdrawal-unknown">
          Not linked to a library product, so its withdrawal is not known here. When you record a
          treatment with it, eggs, milk and meat stay on hold until the owner enters the withdrawal
          from the label or the vet.
        </p>
      {:else}
        <div class="prov-row">
          <Provenance source="plugin" detail={plugin.pluginId} />
          {#if meta.pluginLink === 'manual'}<Provenance source="manual" label="Owner linked" />{/if}
        </div>
        <ul class="uses">
          {#each plugin.labelUses as u (u.speciesId + u.class)}
            <li>
              <strong>{speciesNames[u.speciesId] ?? u.speciesId}</strong>
              <span class="muted">{CLASS_LABEL[u.class] ?? u.class}</span>
              <span>{withdrawalText(u.withdrawal)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </InvSection>

    {#if item}
      <InvSection title="History" kicker="Last 12">
        {#if movements.length === 0}
          <p class="empty">Nothing recorded yet.</p>
        {:else}
          <ul class="movement-list">
            {#each movements.slice(0, 12) as m (m.id)}
              <li>
                <span class="muted small">{fmt.instant(m.occurredAt, 'date')}</span>
                <span>{movementLabel(m.reason)}</span>
                <span class={m.delta < 0 ? 'rust' : 'forest'}>
                  {m.delta > 0 ? '+' : ''}{qty(m.delta)}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </InvSection>
    {/if}
  </div>

  <div class="col">
    {#if item}
      <InvSection title="Quantity" kicker="On hand, ordered, planned">
        <LotQuantities itemId={item.id} unit={item.defaultUnit} category={item.category} {lots} />
      </InvSection>
      <InvSection title="Storage & reorder">
        <InvKVP
          label="Reorder at"
          value={item.reorderThreshold != null ? qty(item.reorderThreshold) : '—'}
        />
        <InvKVP label="Notes" value={item.notes ?? '—'} />
      </InvSection>
    {:else if plugin}
      <InvSection title="Product">
        <InvKVP label="Kind" value={plugin.productKind} />
        <InvKVP label="Sold as" value={plugin.marketingStatus.toUpperCase()} />
        <InvKVP
          label="Active ingredients"
          value={plugin.activeIngredients.map((a) => a.name).join(', ')}
        />
      </InvSection>
    {/if}
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
    overflow-wrap: anywhere;
  }
  .sub {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--color-ink-muted, #6a6f63);
    font-size: 0.9rem;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 14px;
  }
  @media (max-width: 768px) {
    .detail-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .note {
    margin: 0;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--pill-wheat-bg, #e8d9b5);
    line-height: 1.45;
  }
  .prov-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }
  .uses,
  .movement-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .uses li,
  .movement-list li {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    font-size: 0.9rem;
  }
  .empty {
    color: var(--color-ink-muted, #6a6f63);
    margin: 0;
    font-size: 0.9rem;
  }
  .small {
    font-size: 0.8rem;
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
