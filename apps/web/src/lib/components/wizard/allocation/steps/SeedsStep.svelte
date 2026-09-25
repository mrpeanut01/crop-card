<script lang="ts">
  import { getWizardContext } from '../wizardState.svelte';

  const w = getWizardContext();
  const onRefreshParent = $derived(w.props.onRefreshParent);
  const onClose = () => w.props.onClose();

  const filteredEligibleStock = $derived.by(() => {
    const q = w.seedSearch.trim().toLowerCase();
    const matches = q
      ? w.eligibleStock.filter(
          (s) =>
            s.displayName.toLowerCase().includes(q) ||
            (s.cropFamily ?? '').toLowerCase().includes(q)
        )
      : w.eligibleStock;
    return [...matches].sort((a, b) => {
      const fa = a.cropFamily ?? 'zz';
      const fb = b.cropFamily ?? 'zz';
      if (fa !== fb) return fa.localeCompare(fb);
      return a.displayName.localeCompare(b.displayName);
    });
  });

  const seedFamilyGroups = $derived.by(() => {
    const groups = new Map<string, typeof filteredEligibleStock>();
    for (const s of filteredEligibleStock) {
      const key = s.cropFamily ?? '';
      const list = groups.get(key) ?? [];
      list.push(s);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([family, items]) => ({
      family: family || null,
      items
    }));
  });
</script>

<p class="aw-intro">
  Pick the seed lots you want to plant. Adjust quantity per row — defaults to on-hand.
</p>

<!-- #252 / CT-W-007 — surface no-plugin seeds so the operator
     can link them inline without leaving the wizard. Hits
     /api/plugins/search-by-name with skipWebSearch=true (no AI
     quota), then PATCHes /api/stock/[id] with the chosen
     pluginId. On 200 the seed migrates from noPluginStock →
     eligibleStock via the existing onRefreshParent path. -->
{#if w.noPluginStock.length > 0}
  <div class="needs-plugin-section" data-empty-state="needs-plugin">
    <h3 class="needs-plugin-title">
      {w.noPluginStock.length} seed{w.noPluginStock.length === 1 ? '' : 's'} need a crop plugin
    </h3>
    <p class="needs-plugin-lede">
      These seed lots are in your inventory but aren’t linked to a crop plugin yet. Link each one to
      a known crop so the planner can match planting guides, days-to-maturity, and companion rules.
      Picking a plugin is local-only — no Anthropic key needed.
    </p>
    <ul class="needs-plugin-list">
      {#each w.noPluginStock as s (s.stockItemId)}
        <li class="needs-plugin-row">
          <div class="needs-plugin-name">
            <strong>{s.shortName ?? s.displayName}</strong>
            <span class="muted"> · {s.onHand} {s.defaultUnit}</span>
          </div>
          <button
            type="button"
            class="btn-secondary needs-plugin-btn"
            onclick={() => w.seedLink.openLinkPicker(s.stockItemId)}
            disabled={!!w.seedLink.linkAssigningId}
            data-action="open-link-picker"
          >
            {w.seedLink.linkPickerOpenFor === s.stockItemId ? 'Picking…' : 'Link to crop plugin →'}
          </button>
          {#if w.seedLink.linkPickerOpenFor === s.stockItemId}
            <div class="link-picker" role="dialog" aria-label="Pick a crop plugin">
              <input
                type="search"
                class="aw-search"
                placeholder="Search by crop name (e.g. corn, lettuce, basil)…"
                bind:value={w.seedLink.linkQuery}
                oninput={() => w.seedLink.onLinkQueryChange()}
                aria-label="Search crop plugin library"
              />
              {#if w.seedLink.linkSearching}
                <p class="muted">Searching plugin library…</p>
              {:else if w.seedLink.linkError}
                <p class="error" role="alert">{w.seedLink.linkError}</p>
              {:else if w.seedLink.linkQuery.trim().length < 2}
                <p class="muted">Type at least 2 characters to search your local plugin library.</p>
              {:else if w.seedLink.linkResults.length === 0}
                <p class="muted">
                  No matches in your plugin library. Try a different search, or open
                  <a href="/plugins" target="_blank" rel="noopener">/plugins</a> to add a new crop plugin
                  first.
                </p>
              {:else}
                <ul class="link-results">
                  {#each w.seedLink.linkResults as r (r.pluginId)}
                    <li>
                      <button
                        type="button"
                        class="link-result"
                        onclick={() => w.seedLink.assignPluginToStock(s.stockItemId, r.pluginId)}
                        disabled={!!w.seedLink.linkAssigningId}
                      >
                        <span class="link-result-name">{r.displayName}</span>
                        <span class="muted link-result-score"
                          >{Math.round(r.score * 100)}% match</span
                        >
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
              <div class="link-picker-footer">
                <button
                  type="button"
                  class="btn-secondary"
                  onclick={() => w.seedLink.closeLinkPicker()}
                  disabled={w.seedLink.linkAssigningId === s.stockItemId}
                >
                  Cancel
                </button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

{#if w.eligibleStock.length === 0 && w.noPluginStock.length === 0}
  <!-- #175 (CT-W-006) — empty-state card replaces the previous
       dead-end `<p>`. The Sprint-1 link-out path opens
       /stock/add in a new tab so the wizard modal + step state
       stay mounted while the user adds inventory; the Sprint-3
       follow-up extends this same `.aw-seed-empty` block with
       an inline embedded form (toggle pattern) without changing
       the CTAs below. Touch this block, not its callers. -->
  <div class="aw-seed-empty" data-empty-state="seed-stock">
    <h3 class="aw-seed-empty-title">No seed stock yet</h3>
    <p class="aw-seed-empty-lede">
      Seed lots are tracked in Inventory — packets, bulk orders, and saved seed all belong there.
      Add at least one lot with a known crop plugin and on-hand greater than zero, then come back
      here to plan the season.
    </p>
    <div class="aw-seed-empty-actions">
      <a
        class="btn-primary"
        href="/inventory/seed/add"
        target="_blank"
        rel="noopener"
        data-action="add-seed-stock"
      >
        Add seed stock ↗
      </a>
      <a
        class="btn-secondary"
        href="/inventory?type=seed"
        target="_blank"
        rel="noopener"
        data-action="open-stock"
      >
        Open Inventory ↗
      </a>
      <button
        type="button"
        class="btn-secondary"
        onclick={() => w.seedLink.refreshSeedStock()}
        disabled={w.seedLink.seedStockRefreshing || !onRefreshParent}
        data-action="refresh-seed-stock"
      >
        {w.seedLink.seedStockRefreshing ? 'Refreshing…' : 'I’ve added stock — refresh'}
      </button>
      <!-- #175 — explicit skip path so the seeds step is never a
           dead-end. Closes the wizard with a clear "come back later"
           gesture; pairs with #173 Save & resume later once that
           lands. -->
      <button type="button" class="btn-link" onclick={onClose} data-action="skip-seeds-for-now">
        Skip — I’ll add seed stock later
      </button>
    </div>
  </div>
{:else if w.eligibleStock.length === 0 && w.noPluginStock.length > 0}
  <p class="empty">Link a crop plugin to a seed above to make it available for planning.</p>
{:else}
  <div class="aw-search-row">
    <input
      type="search"
      class="aw-search"
      placeholder="Search by variety or family…"
      aria-label="Search seed lots"
      bind:value={w.seedSearch}
    />
    {#if w.seedSearch.trim().length > 0}
      <span class="muted">
        {filteredEligibleStock.length} of {w.eligibleStock.length}
      </span>
    {/if}
  </div>
  {#if filteredEligibleStock.length === 0}
    <p class="empty">No seeds match “{w.seedSearch}”.</p>
  {:else}
    <table class="aw-table">
      <thead>
        <tr>
          <th></th>
          <th>Variety</th>
          <th>On hand</th>
          <th>Quantity</th>
          <th>
            ≈ plants
            <button
              type="button"
              class="aw-info"
              aria-label="Why is this less than the seed count?"
              title="Estimated plants the seed will yield, applying an 85% germination assumption.&#10;&#10;• Seeds: count × 0.85 (e.g. 25 seeds → ~21 plants)&#10;• lb / oz / g: converted to seeds via the crop's seeds-per-lb (from the plugin if known, else a family default), then × 0.85&#10;• Count: treated 1:1 (no germination discount — already discrete plants like transplants or plugs)&#10;&#10;Real germination varies by lot and conditions; treat this as a sizing estimate, not a guarantee."
              >ⓘ</button
            >
          </th>
        </tr>
      </thead>
      <tbody>
        {#each seedFamilyGroups as g (g.family ?? '__unc__')}
          {@const famCount = w.familySelectedCount(g.items)}
          <tr class="family-row">
            <td colspan="5">
              <span class="family-name">{g.family ?? 'Unclassified'}</span>
              <span class="muted">({famCount} of {g.items.length} selected)</span>
              <span class="family-actions">
                <button
                  type="button"
                  class="family-action-btn"
                  onclick={() => w.selectAllInFamily(g.items)}
                  disabled={famCount === g.items.length}
                  aria-label={`Select all ${g.family ?? 'unclassified'} seeds`}>Select all</button
                >
                {#if famCount > 0}
                  <button
                    type="button"
                    class="family-action-btn family-action-clear"
                    onclick={() => w.clearFamily(g.items)}
                    aria-label={`Clear ${g.family ?? 'unclassified'} selection`}>Clear</button
                  >
                {/if}
              </span>
            </td>
          </tr>
          {#each g.items as s (s.stockItemId)}
            {@const checked = w.selectedSeeds.has(s.stockItemId)}
            {@const qty = w.selectedSeeds.get(s.stockItemId) ?? s.onHand}
            {@const plants = w.plantsFor(s.stockItemId, qty)}
            <tr class:row-checked={checked}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Select ${s.shortName ?? s.displayName}`}
                  {checked}
                  onchange={() => w.toggleSeed(s)}
                />
              </td>
              <td title={s.displayName}>
                <div class="seed-name-cell">
                  <span class="seed-name-primary">{s.shortName ?? s.displayName}</span>
                  {#if s.shortName && s.shortName !== s.displayName}
                    <span class="seed-name-sub">{s.displayName}</span>
                  {/if}
                </div>
              </td>
              <td>{s.onHand} {s.defaultUnit}</td>
              <td>
                <input
                  type="number"
                  min="0"
                  max={s.onHand}
                  step="0.25"
                  value={qty}
                  disabled={!checked}
                  oninput={(e) =>
                    w.setSeedQuantity(s.stockItemId, Number((e.target as HTMLInputElement).value))}
                />
                {s.defaultUnit}
              </td>
              <td>{plants !== null ? plants.toLocaleString() : '—'}</td>
            </tr>
          {/each}
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

<style>
  .aw-intro {
    margin: 0 0 0.75rem;
    color: #4a5d4a;
  }
  .aw-table {
    width: 100%;
    border-collapse: collapse;
  }
  .aw-table th,
  .aw-table td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #e4e9e4;
    text-align: left;
    vertical-align: middle;
  }
  .aw-table th {
    background: #f8fbf9;
    color: var(--color-forest);
    font-weight: 700;
    font-size: 0.9rem;
  }
  .aw-table input[type='number'] {
    width: 5rem;
    min-height: 32px;
    padding: 0.25rem 0.4rem;
    border: 1px solid #cbd5cb;
    border-radius: 4px;
    text-align: right;
  }
  .row-checked {
    background: #f3f9f4;
  }
  .seed-name-cell {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    line-height: 1.2;
  }
  .seed-name-primary {
    font-weight: 600;
    color: #1a1a1a;
  }
  .seed-name-sub {
    font-size: 0.78rem;
    color: #6b7280;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 320px;
  }
  .muted {
    color: #6a7d6a;
    font-size: 0.9rem;
  }
  .aw-search-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .aw-search {
    flex: 1;
    min-height: 36px;
    padding: 0.4rem 0.6rem;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
    font-size: 0.95rem;
  }
  .family-row td {
    background: #eef4ef;
    color: var(--color-forest);
    font-weight: 700;
    font-size: 0.85rem;
    text-transform: capitalize;
    padding: 0.35rem 0.75rem;
  }
  .family-row .family-name {
    margin-right: 0.4rem;
  }
  .family-actions {
    float: right;
    display: inline-flex;
    gap: 0.4rem;
  }
  .family-action-btn {
    background: white;
    color: var(--color-forest);
    border: 1px solid var(--color-forest);
    border-radius: 4px;
    padding: 0.12rem 0.55rem;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    line-height: 1.4;
    min-height: 24px;
  }
  .family-action-btn:hover:not(:disabled) {
    background: #f0f5f1;
  }
  .family-action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .family-action-clear {
    border-color: #b8860b;
    color: #6a4f00;
  }
  .family-action-clear:hover {
    background: #fff8e6;
  }
  .aw-info {
    display: inline-block;
    margin-left: 0.25rem;
    padding: 0;
    background: none;
    border: 0;
    color: #6a7d6a;
    cursor: help;
    font-size: 0.85em;
    line-height: 1;
    user-select: none;
  }
  .aw-info:hover,
  .aw-info:focus {
    color: var(--color-forest);
    outline: none;
  }
  .btn-primary,
  .btn-secondary {
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 6px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid #cbd5cb;
  }
  .btn-primary {
    background: var(--color-forest);
    color: white;
    border-color: var(--color-forest);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: white;
    color: #4a5d4a;
  }
  .empty {
    color: #6a7d6a;
    font-style: italic;
  }
  /* #175 (CT-W-006) — Seeds step empty-state card. Sized to feel like
     a "next step" card rather than an error. Sprint 3 extends this
     block with an inline embedded stock-add form; keep the class
     names stable so that work doesn't need to re-style. */
  .aw-seed-empty {
    border: 1px solid var(--color-divider, #d8dcd1);
    border-radius: 12px;
    padding: 1.25rem 1.4rem 1.4rem;
    background: var(--color-cream, #fbfaf3);
    margin-block: 1rem 0.5rem;
  }
  .aw-seed-empty-title {
    margin: 0 0 0.4rem 0;
    font-size: 1.05rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .aw-seed-empty-lede {
    margin: 0 0 1rem 0;
    color: #4a5a4a;
    line-height: 1.45;
  }
  .aw-seed-empty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
  }
  .aw-seed-empty-actions .btn-primary,
  .aw-seed-empty-actions .btn-secondary {
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  .aw-seed-empty-actions .btn-link {
    background: transparent;
    border: none;
    color: var(--color-ink-muted);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
    padding: 0.5rem 0.6rem;
    margin-left: auto;
  }
  .aw-seed-empty-actions .btn-link:hover {
    color: var(--color-forest-deep, #1f3522);
  }
  /* #252 / CT-W-007 — needs-plugin section. Same visual register as
     the wizard-Seeds empty-state (#175) so the operator reads the
     two empty-states as a consistent "data is incomplete; here's how
     to recover" pattern. */
  .needs-plugin-section {
    border: 1px solid var(--color-wheat-deep, #c98e2e);
    border-radius: 12px;
    padding: 1.25rem 1.4rem 1.4rem;
    background: #fff7e6;
    margin-block: 1rem;
  }
  .needs-plugin-title {
    margin: 0 0 0.4rem 0;
    font-size: 1.05rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .needs-plugin-lede {
    margin: 0 0 1rem 0;
    color: #4a5a4a;
    line-height: 1.45;
  }
  .needs-plugin-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .needs-plugin-row {
    background: var(--color-cream, #fbfaf3);
    border: 1px solid var(--color-divider, #d8dcd1);
    border-radius: 8px;
    padding: 0.75rem 0.875rem;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem 0.75rem;
    align-items: center;
  }
  .needs-plugin-name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .needs-plugin-btn {
    min-height: 38px;
    white-space: nowrap;
  }
  /* Inline picker spans both grid columns so the search input has room. */
  .link-picker {
    grid-column: 1 / -1;
    border-top: 1px dashed var(--color-divider);
    padding-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .link-results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .link-result {
    width: 100%;
    text-align: left;
    background: #fff;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: 44px;
    font-family: inherit;
    font-size: 14px;
    color: var(--color-ink);
  }
  .link-result:hover:not(:disabled) {
    border-color: var(--color-forest-deep);
    background: var(--color-paper);
  }
  .link-result:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .link-result-name {
    font-weight: 500;
  }
  .link-result-score {
    font-size: 12px;
  }
  .link-picker-footer {
    display: flex;
    justify-content: flex-end;
  }
</style>
