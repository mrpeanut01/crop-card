<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { ALL_STOCK_UNITS, type StockUnit } from '$lib/stock/units';

  let { data } = $props();

  type Category =
    | 'herbicide'
    | 'insecticide'
    | 'fungicide'
    | 'fertilizer'
    | 'seed'
    | 'adjuvant'
    | 'fuel'
    | 'part';

  const allCategories: Category[] = [
    'herbicide',
    'insecticide',
    'fungicide',
    'fertilizer',
    'seed',
    'adjuvant',
    'fuel',
    'part'
  ];

  let categoryFilter = $state<'all' | Category>('all');
  const filtered = $derived(
    categoryFilter === 'all' ? data.items : data.items.filter((i) => i.category === categoryFilter)
  );

  const lowItems = $derived(data.items.filter((i) => i.isLow));

  // New SKU form
  let newCategory = $state<Category>('herbicide');
  let newDisplayName = $state('');
  let newDefaultUnit = $state<StockUnit>('fl-oz');
  let newPluginId = $state('');
  let newReorder = $state<number | undefined>(undefined);
  let creating = $state(false);
  let createError = $state<string | null>(null);

  function pickFromPlugin(pluginId: string) {
    const c = data.candidatePlugins.find((p) => p.pluginId === pluginId);
    if (!c) return;
    newPluginId = c.pluginId;
    newDisplayName = c.displayName;
    newCategory = c.type;
  }

  async function createItem() {
    if (!newDisplayName.trim()) return;
    creating = true;
    createError = null;
    try {
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: newCategory,
          displayName: newDisplayName.trim(),
          defaultUnit: newDefaultUnit,
          pluginId: newPluginId || undefined,
          reorderThreshold: newReorder
        })
      });
      const out = await res.json();
      if (!res.ok) {
        createError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      newDisplayName = '';
      newPluginId = '';
      newReorder = undefined;
      await invalidateAll();
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }

  function fmt(ts?: number) {
    return ts ? new Date(ts).toLocaleDateString() : '—';
  }
</script>

<h1>Stock</h1>
<p class="lede">
  On-hand inventory: herbicides, insecticides, fungicides, fertilizer, seed, adjuvants, fuel, parts.
  Spray events auto-decrement linked SKUs via FIFO oldest non-expired lot.
</p>

{#if lowItems.length > 0}
  <section class="alert" role="status" aria-live="polite">
    <strong
      >⚠ {lowItems.length} item{lowItems.length === 1 ? '' : 's'} at or below reorder threshold:</strong
    >
    <ul>
      {#each lowItems as i (i.id)}
        <li>
          <a href="/stock/{i.id}">{i.displayName}</a>
          — {i.onHand}
          {i.defaultUnit} on hand (threshold {i.reorderThreshold}
          {i.defaultUnit})
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="card">
  <h2>Filter</h2>
  <div class="chips">
    <button
      class="chip"
      class:active={categoryFilter === 'all'}
      onclick={() => (categoryFilter = 'all')}
    >
      All ({data.items.length})
    </button>
    {#each allCategories as c (c)}
      {@const count = data.items.filter((i) => i.category === c).length}
      {#if count > 0 || categoryFilter === c}
        <button
          class="chip"
          class:active={categoryFilter === c}
          onclick={() => (categoryFilter = c)}
        >
          {c} ({count})
        </button>
      {/if}
    {/each}
  </div>
</section>

{#if data.canEdit}
  <section class="card">
    <h2>Add SKU</h2>
    {#if data.candidatePlugins.length > 0}
      <label class="full">
        From a registered plugin (auto-fills name + category)
        <select onchange={(e) => pickFromPlugin((e.target as HTMLSelectElement).value)}>
          <option value="">— pick a herbicide/insecticide plugin —</option>
          {#each data.candidatePlugins as p (p.pluginId)}
            <option value={p.pluginId}>{p.displayName} ({p.type})</option>
          {/each}
        </select>
      </label>
    {/if}
    <div class="grid">
      <label>
        Category
        <select bind:value={newCategory}>
          {#each allCategories as c}<option value={c}>{c}</option>{/each}
        </select>
      </label>
      <label>
        Display name
        <input type="text" bind:value={newDisplayName} placeholder="e.g. 2,4-D Amine" />
      </label>
      <label>
        Default unit (storage)
        <select bind:value={newDefaultUnit}>
          {#each ALL_STOCK_UNITS as u}<option value={u}>{u}</option>{/each}
        </select>
      </label>
      <label>
        Reorder when ≤
        <input type="number" min="0" step="0.01" bind:value={newReorder} />
      </label>
      <label>
        Plugin id (optional)
        <input type="text" bind:value={newPluginId} placeholder="e.g. 2-4-d-amine" />
      </label>
    </div>
    <button class="primary" onclick={createItem} disabled={creating || !newDisplayName.trim()}>
      {creating ? '…' : 'Add SKU'}
    </button>
    {#if createError}<p class="error">{createError}</p>{/if}
  </section>
{:else}
  <section class="card role-notice">
    <p>📚 View only — helper role can browse stock but cannot add SKUs or receive lots.</p>
  </section>
{/if}

{#if filtered.length === 0}
  <section class="card empty">
    <p>No SKUs in this category yet.</p>
  </section>
{:else}
  <ul class="items">
    {#each filtered as i (i.id)}
      <li class="card item" class:low={i.isLow}>
        <header>
          <a href="/stock/{i.id}"><strong>{i.displayName}</strong></a>
          <span class="cat">{i.category}</span>
          {#if i.pluginId}<code>{i.pluginId}</code>{/if}
        </header>
        <dl>
          <dt>On hand</dt>
          <dd>
            <span class="big">{i.onHand}</span>
            {i.defaultUnit}
            {#if i.isLow}<span class="low-badge">⚠ low</span>{/if}
          </dd>
          {#if i.reorderThreshold !== undefined}
            <dt>Reorder at</dt>
            <dd>{i.reorderThreshold} {i.defaultUnit}</dd>
          {/if}
          <dt>Lots</dt>
          <dd>
            {i.lotCount}
            {#if i.earliestExpiry}
              · earliest expires {fmt(i.earliestExpiry)}
            {/if}
          </dd>
        </dl>
      </li>
    {/each}
  </ul>
{/if}

<style>
  h1 {
    margin: 0 0 0.25rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1.5rem;
  }
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .alert {
    background: #fff3cd;
    color: #b35900;
    padding: 0.75rem 1rem;
    border-radius: 4px;
    border-left: 4px solid #b35900;
    margin-bottom: 1rem;
  }
  .alert ul {
    margin: 0.4rem 0 0 1.25rem;
    padding: 0;
  }
  .alert a {
    color: #b35900;
    text-decoration: underline;
  }
  .chips {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .chip {
    background: white;
    border: 2px solid #d0d7d0;
    padding: 0.4rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    text-transform: capitalize;
    font: inherit;
    min-height: 40px;
  }
  .chip.active {
    background: #1f5e3a;
    color: white;
    border-color: #1f5e3a;
  }
  .role-notice {
    border-left: 4px solid #b35900;
    background: #fff8ec;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.5rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  label.full {
    display: flex;
    margin-bottom: 0.5rem;
  }
  input[type='text'],
  input[type='number'],
  select {
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
    font-family: inherit;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
    margin-top: 0.5rem;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .error {
    color: #b00020;
  }
  .empty {
    text-align: center;
    padding: 2rem;
    color: #555;
  }
  .items {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .item.low {
    border-left: 4px solid #b35900;
  }
  .item header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .item header a {
    color: #1f5e3a;
    text-decoration: none;
    font-weight: 700;
    font-size: 1.1rem;
  }
  .item header a:hover {
    text-decoration: underline;
  }
  .cat {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.05rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .item header code {
    background: #f5f5f5;
    color: #555;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.8rem;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 0;
    font-size: 0.9rem;
  }
  dt {
    color: #666;
  }
  dd {
    margin: 0;
  }
  .big {
    font-family: monospace;
    font-weight: 700;
    font-size: 1.3rem;
    color: #1f5e3a;
  }
  .low-badge {
    background: #fff3cd;
    color: #b35900;
    padding: 0.05rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    margin-left: 0.5rem;
  }
</style>
