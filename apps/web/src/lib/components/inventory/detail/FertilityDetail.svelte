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
  import InvSection from '../InvSection.svelte';
  import InvKVP from '../InvKVP.svelte';
  import type { FertilityDetailPayload } from '../../../../routes/inventory/[type]/[id]/+page.server';

  type Props = Omit<FertilityDetailPayload, 'type'>;
  const { item, lots, movements, plugin }: Props = $props();

  const npk = $derived(plugin?.analysis ?? { n: 0, p: 0, k: 0 });
  const npkMax = $derived(Math.max(npk.n, npk.p, npk.k, 1));
</script>

<header class="detail-header">
  <span class="kicker">Fertility</span>
  <h1 class="serif">{item.displayName}</h1>
  {#if plugin}
    <p class="sub">
      N–P₂O₅–K₂O <span class="mono">{npk.n}-{npk.p}-{npk.k}</span>
      {#if plugin.organic}· <span class="omri">OMRI</span>{/if}
    </p>
  {/if}
</header>

<div class="detail-grid">
  <div class="col">
    <InvSection title="Guaranteed analysis" kicker="Label">
      <div class="npk-bars">
        <div class="npk-row">
          <span class="npk-label">N</span>
          <div class="npk-bar">
            <div class="fill n" style="width: {(npk.n / npkMax) * 100}%"></div>
          </div>
          <span class="npk-val mono">{npk.n}%</span>
        </div>
        <div class="npk-row">
          <span class="npk-label">P₂O₅</span>
          <div class="npk-bar">
            <div class="fill p" style="width: {(npk.p / npkMax) * 100}%"></div>
          </div>
          <span class="npk-val mono">{npk.p}%</span>
        </div>
        <div class="npk-row">
          <span class="npk-label">K₂O</span>
          <div class="npk-bar">
            <div class="fill k" style="width: {(npk.k / npkMax) * 100}%"></div>
          </div>
          <span class="npk-val mono">{npk.k}%</span>
        </div>
      </div>
    </InvSection>

    <InvSection title="Application" kicker="Label-derived">
      {#if plugin?.applicationRange}
        <InvKVP
          label="Default rate"
          value={`${plugin.applicationRange.amount} ${plugin.applicationRange.unit}`}
          tone="mono"
        />
      {:else}
        <p class="empty">No application range declared.</p>
      {/if}
      <InvKVP label="Approach class" value={plugin?.organic ? 'OMRI / organic' : 'Conventional'} />
    </InvSection>

    <InvSection title="Nutrient-plan impact" kicker="Phase 21b">
      <p class="empty small">
        Per-acre delivery rates flow through `inputsPlan.ts` when this product is the
        philosophy-allowed choice for the season's fertility approach.
      </p>
    </InvSection>
  </div>

  <div class="col">
    <InvSection title="On hand">
      <InvKVP
        label="Total"
        value={`${lots.reduce((s, l) => s + l.balance, 0).toFixed(1)} ${item.defaultUnit}`}
      />
      <InvKVP label="Lots" value={lots.length} />
    </InvSection>

    <InvSection title="Storage & reorder">
      <InvKVP
        label="Reorder at"
        value={item.reorderThreshold != null ? `${item.reorderThreshold} ${item.defaultUnit}` : '—'}
      />
      <InvKVP label="Notes" value={item.notes ?? '—'} />
    </InvSection>

    <InvSection title="Application history" kicker="Last 8">
      {#if movements.length === 0}
        <p class="empty">No fertility applications recorded yet.</p>
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
