<script lang="ts">
  import { getWizardContext, planningTotal } from '../wizardState.svelte';
  import SetupSheet from '$lib/components/setup/SetupSheet.svelte';
  import A_InventoryAddFlow from '$lib/components/inventory/A_InventoryAddFlow.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { availableQuantityText } from '$lib/stock/quantityStatus';
  import type { SeedStockEntry } from '../types';

  const w = getWizardContext();
  const onRefreshParent = $derived(w.props.onRefreshParent);
  const onClose = () => w.props.onClose();

  // #475 — add a seed lot without leaving the plan: the canonical 5-method
  // add flow in a sheet, writing through /api/stock like /inventory does.
  let addOpen = $state(false);
  let addNotice = $state<string | null>(null);

  async function onSeedSaved(saved: { id: string | null }) {
    addOpen = false;
    await onRefreshParent?.();
    if (saved.id) {
      w.selectNewSeed(saved.id);
      const entry = w.props.seedStock.find((s) => s.stockItemId === saved.id);
      addNotice = entry
        ? `Added ${entry.shortName ?? entry.displayName} and picked it for this plan.`
        : 'Seed added.';
    }
  }

  const seedLibrary = $derived(
    (w.props.cropCatalog ?? []).map((c) => ({ id: c.pluginId, name: c.displayName }))
  );

  function availableText(s: SeedStockEntry): string {
    return availableQuantityText(
      { existing: s.onHand, ordered: s.onOrder ?? 0, planned: s.planned ?? 0 },
      s.defaultUnit
    );
  }

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

<div class="aw-seeds-head">
  <p class="aw-intro">
    Pick the seed lots you want to plant. The quantity starts at what you have on hand plus what is
    ordered or planned, and you can change it on each row.
  </p>
  <button
    type="button"
    class="btn-secondary aw-add-seed"
    onclick={() => {
      addNotice = null;
      addOpen = true;
    }}
    disabled={!onRefreshParent}
    data-action="add-seed-inline"
  >
    + Add seed
  </button>
</div>
{#if addNotice}<p class="aw-notice" role="status">{addNotice}</p>{/if}

<SetupSheet
  open={addOpen}
  title="Add seed to inventory"
  kicker="Planning"
  onClose={() => (addOpen = false)}
>
  <A_InventoryAddFlow
    type="seed"
    library={seedLibrary}
    aiEnabled={w.props.aiEnabled}
    onSaved={onSeedSaved}
    onCancel={() => (addOpen = false)}
  />
</SetupSheet>

<!-- #252 / CT-W-007 — surface no-plugin seeds so the operator
     can link them inline without leaving the wizard. Hits
     /api/plugins/search-by-name with skipWebSearch=true (no AI
     quota), then PATCHes /api/stock/[id] with the chosen
     pluginId. On 200 the seed migrates from noPluginStock →
     eligibleStock via the existing onRefreshParent path. -->
{#if w.noPluginStock.length > 0}
  <div class="needs-plugin-section" data-empty-state="needs-plugin">
    <h3 class="needs-plugin-title">
      {w.noPluginStock.length}
      {w.noPluginStock.length === 1 ? 'seed needs' : 'seeds need'} a crop category
    </h3>
    <p class="needs-plugin-lede">
      These seed lots are in your inventory but don't have a crop category yet. Pick the crop each
      one is, so the planner can match planting guides, days to maturity and companion rules. This
      search stays on your farm and needs no AI.
    </p>
    <ul class="needs-plugin-list">
      {#each w.noPluginStock as s (s.stockItemId)}
        <li class="needs-plugin-row">
          <div class="needs-plugin-name">
            <strong>{s.shortName ?? s.displayName}</strong>
            <span class="muted"> · {availableText(s)}</span>
          </div>
          <button
            type="button"
            class="btn-secondary needs-plugin-btn"
            onclick={() => w.seedLink.openLinkPicker(s.stockItemId)}
            disabled={!!w.seedLink.linkAssigningId}
            data-action="open-link-picker"
          >
            {w.seedLink.linkPickerOpenFor === s.stockItemId ? 'Picking…' : 'Pick a crop category →'}
          </button>
          {#if w.seedLink.linkPickerOpenFor === s.stockItemId}
            <div class="link-picker" role="dialog" aria-label="Pick a crop category">
              <input
                type="search"
                class="aw-search"
                placeholder="Search by crop name (e.g. corn, lettuce, basil)…"
                bind:value={w.seedLink.linkQuery}
                oninput={() => w.seedLink.onLinkQueryChange()}
                aria-label="Search crop categories"
              />
              {#if w.seedLink.linkSearching}
                <p class="muted">Searching crops…</p>
              {:else if w.seedLink.linkError}
                <p class="error" role="alert">{w.seedLink.linkError}</p>
              {:else if w.seedLink.linkQuery.trim().length < 2}
                <p class="muted">Type at least 2 letters to search your crops.</p>
              {:else if w.seedLink.linkResults.length === 0}
                <p class="muted">
                  No crops match. Try a different search, or
                  <a href="/inventory?type=crop&mode=catalog" target="_blank" rel="noopener"
                    >add the crop in Inventory</a
                  > first.
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
      Seed is tracked in Inventory: packets, bulk orders and saved seed all belong there. Add what
      you have, what you have ordered, or what you plan to buy. You can add it here without leaving
      the plan.
    </p>
    <div class="aw-seed-empty-actions">
      <button
        type="button"
        class="btn-primary"
        onclick={() => (addOpen = true)}
        disabled={!onRefreshParent}
        data-action="add-seed-stock"
      >
        Add seed
      </button>
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
  <p class="empty">Pick a crop category for a seed above to make it available for planning.</p>
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
          <th>Available</th>
          <th>Quantity</th>
          <th>
            ≈ plants
            <button
              type="button"
              class="aw-info"
              aria-label="Why is this less than the seed count?"
              title="Estimated plants the seed will yield, applying an 85% germination assumption.&#10;&#10;• Seeds: count × 0.85 (e.g. 25 seeds → about 21 plants)&#10;• lb / oz / g: converted to seeds using the crop's seeds per pound (from the crop if known, else a family default), then × 0.85&#10;&#10;Real germination varies by lot and conditions; treat this as a sizing estimate, not a guarantee."
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
            {@const total = planningTotal(s)}
            {@const qty = w.selectedSeeds.get(s.stockItemId) ?? total}
            {@const fill = checked && w.isFillToBed(s.stockItemId)}
            {@const plants = w.plantsFor(s.stockItemId, qty)}
            <tr class:row-checked={checked}>
              <td>
                <label class="seed-pick">
                  <input
                    id={`aw-seed-${s.stockItemId}`}
                    type="checkbox"
                    aria-label={`Select ${s.shortName ?? s.displayName}`}
                    {checked}
                    onchange={() => w.toggleSeed(s)}
                  />
                </label>
              </td>
              <td title={s.displayName}>
                <label class="seed-name-cell" for={`aw-seed-${s.stockItemId}`}>
                  <span class="seed-name-primary">{s.shortName ?? s.displayName}</span>
                  {#if s.shortName && s.shortName !== s.displayName}
                    <span class="seed-name-sub">{s.displayName}</span>
                  {/if}
                </label>
              </td>
              <td class="aw-avail" data-testid="seed-available" data-label="Available">
                {availableText(s)}
              </td>
              <td class="aw-qty" data-label="Quantity">
                <input
                  type="number"
                  min="0"
                  max={total > 0 ? total : undefined}
                  step="0.25"
                  value={fill ? '' : qty}
                  placeholder={fill ? 'Not set' : undefined}
                  disabled={!checked}
                  aria-label={`Quantity of ${s.shortName ?? s.displayName}`}
                  oninput={(e) =>
                    w.setSeedQuantity(s.stockItemId, Number((e.target as HTMLInputElement).value))}
                />
                {s.defaultUnit}
                {#if fill}
                  <span class="aw-fill" data-testid="fill-to-bed">
                    <Provenance source="fallback" compact />
                    Quantity not set, will size to bed
                  </span>
                {/if}
              </td>
              <td data-label="≈ plants">
                {fill ? '—' : plants !== null ? plants.toLocaleString() : '—'}
              </td>
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
  .aw-seeds-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .aw-seeds-head .aw-intro {
    flex: 1 1 16rem;
  }
  .aw-add-seed {
    min-height: 48px;
  }
  .aw-notice {
    margin: 0 0 0.6rem;
    padding: 0.5rem 0.7rem;
    background: #eef4ef;
    border-radius: 6px;
    color: var(--color-forest-deep, #1f3522);
    font-size: 0.9rem;
  }
  .aw-avail {
    font-size: 0.85rem;
    color: #4a5d4a;
  }
  .aw-fill {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.25rem;
    font-size: 0.78rem;
    color: #7a3f22;
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
  .seed-pick {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 48px;
    min-height: 48px;
    cursor: pointer;
  }
  .seed-pick input {
    width: 22px;
    height: 22px;
    margin: 0;
    accent-color: var(--color-forest);
  }
  .seed-name-cell {
    cursor: pointer;
    min-height: 48px;
    justify-content: center;
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
    max-width: min(320px, 100%);
  }
  /* Phone width: each seed becomes a stacked card so nothing is cut off. */
  @media (max-width: 560px) {
    .aw-table,
    .aw-table tbody,
    .aw-table tr,
    .aw-table td {
      display: block;
      width: 100%;
      box-sizing: border-box;
    }
    .aw-table thead {
      display: none;
    }
    .aw-table tr:not(.family-row) {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      border-bottom: 1px solid #e4e9e4;
    }
    .aw-table tr:not(.family-row) td {
      border-bottom: none;
      padding: 0.35rem 0.5rem;
      grid-column: 2;
    }
    .aw-table tr:not(.family-row) td:first-child {
      grid-column: 1;
      grid-row: 1 / span 4;
      padding: 0;
    }
    .aw-table td[data-label]::before {
      content: attr(data-label) ': ';
      font-weight: 600;
      color: var(--color-forest);
    }
    .family-row td {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem;
    }
    .seed-name-sub {
      white-space: normal;
    }
    .family-row .family-action-btn,
    .aw-table td input[type='number'] {
      min-height: 48px;
    }
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
