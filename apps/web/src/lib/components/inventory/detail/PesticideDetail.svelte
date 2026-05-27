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
  import InvSection from '../InvSection.svelte';
  import InvKVP from '../InvKVP.svelte';
  import type { PesticideDetailPayload } from '../../../../routes/inventory/[type]/[id]/+page.server';

  type Props = Omit<PesticideDetailPayload, 'type'>;
  const { item, lots, movements, plugin }: Props = $props();
</script>

<header class="detail-header">
  <span class="kicker">Pesticide</span>
  <h1 class="serif">{item.displayName}</h1>
  {#if plugin?.activeIngredients?.length}
    <p class="sub">
      {plugin.activeIngredients.map((ai) => ai.name).join(' · ')}
    </p>
  {/if}
</header>

<div class="detail-grid">
  <div class="col">
    <InvSection title="Catalog plugin" kicker="Source">
      {#if plugin}
        <InvKVP label="Plugin id" value={plugin.pluginId} tone="mono" />
        <InvKVP label="Display name" value={plugin.displayName} />
      {:else}
        <p class="empty">No plugin bound — Manual / OCR entry. Link via Edit.</p>
      {/if}
    </InvSection>

    <InvSection title="Safety kernel" kicker="Plugin-bound">
      <InvKVP label="EPA reg" value={plugin?.epaRegistrationNumber ?? '—'} tone="locked" />
      <InvKVP
        label="Re-entry interval"
        value={plugin?.reEntryIntervalHours != null ? `${plugin.reEntryIntervalHours} h` : '—'}
        tone="locked"
      />
      <InvKVP
        label="Pre-harvest interval"
        value={plugin?.preHarvestIntervalDays != null ? `${plugin.preHarvestIntervalDays} d` : '—'}
        tone="locked"
      />
      {#if plugin?.activeIngredients?.length}
        <div class="ai-list">
          {#each plugin.activeIngredients as ai}
            <span class="ai-chip"
              >{ai.name}{ai.chemistryClass ? ` (${ai.chemistryClass})` : ''}</span
            >
          {/each}
        </div>
      {/if}
    </InvSection>

    <InvSection title="Application rate" kicker="Label-derived">
      {#if plugin?.ratePerAcre}
        <InvKVP
          label="Default rate"
          value={`${plugin.ratePerAcre.amount} ${plugin.ratePerAcre.unit}`}
          tone="mono"
        />
      {:else}
        <p class="empty">No default rate declared on plugin.</p>
      {/if}
    </InvSection>
  </div>

  <div class="col">
    <InvSection title="On hand">
      <InvKVP
        label="Total"
        value={`${lots.reduce((s, l) => s + l.balance, 0).toFixed(1)} ${item.defaultUnit}`}
      />
      <InvKVP label="Lots" value={lots.length} />
      {#if lots.length > 0}
        <ul class="lot-list">
          {#each lots as lot (lot.id)}
            <li>
              <span class="mono">{lot.lotNumber ?? '—'}</span>
              <span class="muted">{lot.balance.toFixed(1)} {item.defaultUnit}</span>
              {#if lot.expiresAt}
                <span class="muted small">exp {new Date(lot.expiresAt).toLocaleDateString()}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </InvSection>

    <InvSection title="Storage & reorder">
      <InvKVP
        label="Reorder at"
        value={item.reorderThreshold != null ? `${item.reorderThreshold} ${item.defaultUnit}` : '—'}
      />
      <InvKVP label="Notes" value={item.notes ?? '—'} />
    </InvSection>

    <InvSection title="Recent usage" kicker="Last 25">
      {#if movements.length === 0}
        <p class="empty">No recorded movements.</p>
      {:else}
        <ul class="movement-list">
          {#each movements.slice(0, 8) as m (m.id)}
            <li>
              <span class="muted small">{new Date(m.occurredAt).toLocaleDateString()}</span>
              <span class="mono">{m.reason}</span>
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
  .lot-list,
  .movement-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .lot-list li,
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
