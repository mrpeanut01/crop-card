<script lang="ts">
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
  import InvSection from '../InvSection.svelte';
  import InvKVP from '../InvKVP.svelte';
  import LotQuantities from '../LotQuantities.svelte';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { formatStockQuantity } from '$lib/stock/units';
  import type { SeedDetailPayload } from '../../../../routes/inventory/[type]/[id]/+page.server';

  type Props = Omit<SeedDetailPayload, 'type'>;
  const { item, lots, movements, plugin }: Props = $props();

  const stockQty = (v: number, digits?: number) =>
    formatStockQuantity(v, item.defaultUnit, currentPrefs(), { digits, category: item.category });
</script>

<header class="detail-header">
  <div>
    <span class="kicker">Seed · {plugin?.cropFamily ?? 'unknown family'}</span>
    <h1 class="serif">{item.displayName}</h1>
    {#if plugin?.daysToMaturity}
      <p class="sub">
        <span class="mono">{plugin.daysToMaturity.min}–{plugin.daysToMaturity.max} d</span> to maturity
      </p>
    {/if}
  </div>
  <a class="edit-cta" href="/inventory/seed/{item.id}/edit">Edit</a>
</header>

<div class="detail-grid">
  <div class="col">
    <InvSection title="Crop category" kicker="Linked">
      {#if plugin}
        <InvKVP label="Category" value={plugin.displayName} />
        <InvKVP label="Crop family" value={plugin.cropFamily ?? '—'} />
        <InvKVP label="Archetype" value={plugin.archetype ?? '—'} tone="locked" />
        <p class="cta-row">
          <a href="/inventory/crop/{encodeURIComponent(plugin.pluginId)}">Open the crop →</a>
        </p>
      {:else}
        <p class="empty">
          No crop category linked yet. Pick one with Edit so the planner can use this seed.
        </p>
      {/if}
    </InvSection>

    <InvSection title="Germination & treatment" kicker="At sourcing">
      <InvKVP label="Notes" value={item.notes ?? '—'} />
    </InvSection>

    <InvSection title="Planting parameters" kicker="From the crop category">
      {#if plugin?.daysToMaturity}
        <InvKVP
          label="Days to maturity"
          value={`${plugin.daysToMaturity.min}–${plugin.daysToMaturity.max} d`}
        />
      {/if}
    </InvSection>
  </div>

  <div class="col">
    <InvSection title="Quantity" kicker="On hand, ordered, planned">
      <LotQuantities itemId={item.id} unit={item.defaultUnit} category={item.category} {lots} />
    </InvSection>

    <InvSection title="Saving / sowing history" kicker="Last 8">
      {#if movements.length === 0}
        <p class="empty">No sowing recorded yet.</p>
      {:else}
        <ul class="movement-list">
          {#each movements.slice(0, 8) as m (m.id)}
            <li>
              <span class="muted small">{fmt.instant(m.occurredAt, 'date')}</span>
              <span class="mono">{m.reason}</span>
              <span class={m.delta < 0 ? 'rust' : 'forest'}>
                {m.delta > 0 ? '+' : ''}{stockQty(m.delta)}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </InvSection>

    <InvSection title="Linked plantings" kicker="Deferred">
      <p class="empty small">
        Per-planting back-reference lands in Phase 28 (seed → planting linkage).
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
