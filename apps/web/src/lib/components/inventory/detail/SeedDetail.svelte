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
  import type { SeedDetailPayload } from '../../../../routes/inventory/[type]/[id]/+page.server';

  type Props = Omit<SeedDetailPayload, 'type'>;
  const { item, lots, movements, plugin }: Props = $props();
</script>

<header class="detail-header">
  <span class="kicker">Seed · {plugin?.cropFamily ?? 'unknown family'}</span>
  <h1 class="serif">{item.displayName}</h1>
  {#if plugin?.daysToMaturity}
    <p class="sub">
      <span class="mono">{plugin.daysToMaturity.min}–{plugin.daysToMaturity.max} d</span> to maturity
    </p>
  {/if}
</header>

<div class="detail-grid">
  <div class="col">
    <InvSection title="Variety provenance" kicker="Plugin-linked">
      {#if plugin}
        <InvKVP label="Plugin id" value={plugin.pluginId} tone="mono" />
        <InvKVP label="Crop family" value={plugin.cropFamily ?? '—'} />
        <InvKVP label="Archetype" value={plugin.archetype ?? '—'} tone="locked" />
      {:else}
        <p class="empty">
          No plugin bound — variety provenance unknown. Link via Edit so the planner can use it.
        </p>
      {/if}
    </InvSection>

    <InvSection title="Germination & treatment" kicker="At sourcing">
      <InvKVP label="Notes" value={item.notes ?? '—'} />
    </InvSection>

    <InvSection title="Planting parameters" kicker="Plugin-bound">
      {#if plugin?.daysToMaturity}
        <InvKVP
          label="Days to maturity"
          value={`${plugin.daysToMaturity.min}–${plugin.daysToMaturity.max} d`}
        />
      {/if}
    </InvSection>
  </div>

  <div class="col">
    <InvSection title="On hand">
      {#if lots.length === 0}
        <p class="empty">No lots received yet — receive a lot via /stock/add to plant.</p>
      {:else}
        <InvKVP
          label="Total"
          value={`${lots.reduce((s, l) => s + l.balance, 0).toFixed(1)} ${item.defaultUnit}`}
        />
        <InvKVP label="Lots" value={lots.length} />
      {/if}
    </InvSection>

    <InvSection title="Saving / sowing history" kicker="Last 8">
      {#if movements.length === 0}
        <p class="empty">No sowing recorded yet.</p>
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
