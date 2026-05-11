<script lang="ts">
  import { seedsToPlants, type SeedPluginShape } from '$lib/seed/quantity';
  import type { CropPlugin } from '$lib/plugins/schemas';

  type SeedStockEntry = {
    stockItemId: string;
    displayName: string;
    /** Phase 15d — short label; falls back to displayName when absent. */
    shortName?: string;
    onHand: number;
    defaultUnit: string;
    cropPluginId: string | null;
    cropFamily: string | null;
  };

  type BlockEntry = {
    id: string;
    name: string;
    blockLabel?: string;
    acres?: number;
    sunExposure?: 'full' | 'partial' | 'shade';
    plantings: Array<{ varietyDisplayName: string }>;
  };

  type CropCatalogItem = {
    pluginId: string;
    displayName: string;
    cropFamily: string;
  };

  type SufficiencyResult = {
    status: 'deficit' | 'match' | 'surplus';
    plantsAvailable: number;
    plantsFit: number;
    utilizationPct: number;
    leftoverPlants: number;
  };

  type AllocationResponse = {
    assignments: Array<{
      stockItemId: string;
      cropPluginId: string;
      varietyDisplayName: string;
      blockId: string;
      plants: number;
    }>;
    unplaced: Array<{ stockItemId: string; cropPluginId: string; quantityPlants: number }>;
    sufficiency: Record<string, SufficiencyResult>;
    rationale: string;
    perRowRationale: Record<string, string>;
    advisories: string[];
    meta: {
      model: string;
      usdEstimate: number;
      fallback?: 'engine-only' | 'no-api-key';
      violationsOnFirstAttempt?: string[];
    };
  };

  let {
    seedStock,
    blocks,
    plantingGuides,
    cropCatalog,
    onClose,
    onCommitted
  }: {
    seedStock: SeedStockEntry[];
    blocks: BlockEntry[];
    plantingGuides: Record<string, NonNullable<CropPlugin['plantingGuide']>>;
    cropCatalog: CropCatalogItem[];
    onClose: () => void;
    onCommitted: () => void;
  } = $props();

  type Step = 'seeds' | 'blocks' | 'review' | 'commit';
  let step: Step = $state('seeds');

  let seedSearch = $state('');

  const eligibleStock = $derived(
    seedStock.filter((s) => !!s.cropPluginId && s.onHand > 0)
  );

  const filteredEligibleStock = $derived.by(() => {
    const q = seedSearch.trim().toLowerCase();
    const matches = q
      ? eligibleStock.filter(
          (s) =>
            s.displayName.toLowerCase().includes(q) ||
            (s.cropFamily ?? '').toLowerCase().includes(q)
        )
      : eligibleStock;
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

  let selectedSeeds = $state<Map<string, number>>(new Map());
  let selectedBlockIds = $state<Set<string>>(new Set());

  let response = $state<AllocationResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let commitProgress = $state<{ done: number; total: number; failed: string[] }>({
    done: 0,
    total: 0,
    failed: []
  });

  function pluginShapeFor(stockItemId: string): SeedPluginShape | undefined {
    const entry = seedStock.find((s) => s.stockItemId === stockItemId);
    if (!entry?.cropPluginId) return undefined;
    return {
      cropFamily: entry.cropFamily ?? undefined,
      plantingGuide: plantingGuides[entry.cropPluginId]
    };
  }

  function plantsFor(stockItemId: string, quantity: number): number | null {
    const entry = seedStock.find((s) => s.stockItemId === stockItemId);
    if (!entry) return null;
    const result = seedsToPlants({
      unit: entry.defaultUnit,
      quantity,
      plugin: pluginShapeFor(stockItemId)
    });
    return result?.plants ?? null;
  }

  function toggleSeed(s: SeedStockEntry) {
    if (selectedSeeds.has(s.stockItemId)) {
      selectedSeeds.delete(s.stockItemId);
    } else {
      selectedSeeds.set(s.stockItemId, s.onHand);
    }
    selectedSeeds = new Map(selectedSeeds);
  }

  function setSeedQuantity(stockItemId: string, quantity: number) {
    const entry = seedStock.find((s) => s.stockItemId === stockItemId);
    if (!entry) return;
    const clamped = Math.max(0, Math.min(entry.onHand, quantity));
    selectedSeeds.set(stockItemId, clamped);
    selectedSeeds = new Map(selectedSeeds);
  }

  function toggleBlock(id: string) {
    if (selectedBlockIds.has(id)) selectedBlockIds.delete(id);
    else selectedBlockIds.add(id);
    selectedBlockIds = new Set(selectedBlockIds);
  }

  function selectAllBlocks() {
    selectedBlockIds = new Set(blocks.map((b) => b.id));
  }

  async function generatePlan() {
    loading = true;
    error = null;
    response = null;
    try {
      const seedSelections = [...selectedSeeds.entries()]
        .filter(([, qty]) => qty > 0)
        .map(([stockItemId, quantity]) => {
          const entry = seedStock.find((s) => s.stockItemId === stockItemId)!;
          const plants = plantsFor(stockItemId, quantity);
          return {
            stockItemId,
            cropPluginId: entry.cropPluginId!,
            varietyDisplayName: entry.displayName,
            quantityPlants: Math.max(1, plants ?? Math.round(quantity))
          };
        });

      const res = await fetch('/api/plan/allocate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seedSelections,
          blockIds: [...selectedBlockIds]
        })
      });
      const body = (await res.json()) as AllocationResponse | { error: string };
      if (!res.ok) {
        error = 'error' in body ? body.error : `HTTP ${res.status}`;
        return;
      }
      response = body as AllocationResponse;
      step = 'review';
    } catch (err) {
      error = err instanceof Error ? err.message : 'request failed';
    } finally {
      loading = false;
    }
  }

  async function commit() {
    if (!response) return;
    step = 'commit';
    error = null;
    commitProgress = {
      done: 0,
      total: response.assignments.length,
      failed: []
    };
    const quantities = buildCommitQuantities(response.assignments);
    for (const a of response.assignments) {
      const seedEntry = seedStock.find((s) => s.stockItemId === a.stockItemId);
      const unit = seedEntry?.defaultUnit ?? 'seeds';
      const quantityForCommit = quantities.get(`${a.stockItemId}:${a.blockId}`) ?? 0;
      try {
        const res = await fetch(`/api/blocks/${a.blockId}/plantings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            cropPluginId: a.cropPluginId,
            varietyDisplayName: a.varietyDisplayName,
            quantityPlanted: quantityForCommit,
            quantityUnit: unit,
            stockItemId: a.stockItemId
          })
        });
        if (!res.ok) {
          commitProgress.failed.push(`${a.varietyDisplayName} → ${blockNameFor(a.blockId)}`);
        }
      } catch {
        commitProgress.failed.push(`${a.varietyDisplayName} → ${blockNameFor(a.blockId)}`);
      }
      commitProgress = { ...commitProgress, done: commitProgress.done + 1 };
    }
    if (commitProgress.failed.length === 0) {
      onCommitted();
    }
  }

  /** Apportion the user's original seed quantity (selectedSeeds) across the
   *  AI's per-block plant assignments. Stock decrement runs against this
   *  number, so the seed quantity actually planted is what gets debited —
   *  not the post-germination plant count. Integer-required units (`seeds`,
   *  `count`, `packets`) use largest-remainder rounding so the per-assignment
   *  values sum back to the user's original quantity. */
  function buildCommitQuantities(
    assignments: AllocationResponse['assignments']
  ): Map<string, number> {
    const out = new Map<string, number>();
    const byStock = new Map<string, AllocationResponse['assignments']>();
    for (const a of assignments) {
      const list = byStock.get(a.stockItemId) ?? [];
      list.push(a);
      byStock.set(a.stockItemId, list);
    }
    for (const [stockItemId, items] of byStock) {
      const entry = seedStock.find((s) => s.stockItemId === stockItemId);
      if (!entry) continue;
      const selectedQty = selectedSeeds.get(stockItemId) ?? 0;
      if (selectedQty <= 0) continue;
      const totalPlants = items.reduce((s, x) => s + x.plants, 0);
      if (totalPlants <= 0) continue;
      const unit = entry.defaultUnit;
      const isInteger = unit === 'seeds' || unit === 'count' || unit === 'packets';
      const raw = items.map((a) => ({
        a,
        raw: (a.plants / totalPlants) * selectedQty
      }));
      if (!isInteger) {
        for (const { a, raw: r } of raw) {
          out.set(`${stockItemId}:${a.blockId}`, Number(r.toFixed(3)));
        }
        continue;
      }
      const target = Math.round(selectedQty);
      const rounded = raw.map((x) => ({
        a: x.a,
        floor: Math.floor(x.raw),
        frac: x.raw - Math.floor(x.raw)
      }));
      let used = rounded.reduce((s, x) => s + x.floor, 0);
      let remainder = target - used;
      const order = [...rounded].sort((x, y) => y.frac - x.frac);
      for (const x of order) {
        if (remainder <= 0) break;
        x.floor += 1;
        remainder -= 1;
      }
      for (const x of rounded) {
        out.set(`${stockItemId}:${x.a.blockId}`, x.floor);
      }
    }
    return out;
  }

  function blockNameFor(blockId: string): string {
    return blocks.find((b) => b.id === blockId)?.name ?? blockId;
  }

  function varietyDisplayFor(stockItemId: string): string {
    const entry = seedStock.find((s) => s.stockItemId === stockItemId);
    return entry?.shortName ?? entry?.displayName ?? stockItemId;
  }

  function sufficiencyChip(
    s: SufficiencyResult
  ): { label: string; cls: string; tooltip: string } {
    const pct = Math.round(s.utilizationPct * 100);
    if (s.status === 'match') {
      return {
        label: `Fills block · ${pct}%`,
        cls: 'chip-match',
        tooltip: `Your seed quantity (${s.plantsAvailable.toLocaleString()} plants) is the right size for this block (fits ${s.plantsFit.toLocaleString()}).`
      };
    }
    if (s.status === 'surplus') {
      return {
        label: `${s.leftoverPlants.toLocaleString()} extra plants`,
        cls: 'chip-surplus',
        tooltip: `You have seed for ${s.plantsAvailable.toLocaleString()} plants but the block only fits ${s.plantsFit.toLocaleString()} — about ${s.leftoverPlants.toLocaleString()} plants worth of seed will be left over.`
      };
    }
    return {
      label: `Only fills ${pct}% of block`,
      cls: 'chip-deficit',
      tooltip: `Your seed quantity (${s.plantsAvailable.toLocaleString()} plants) only covers ${pct}% of the block's capacity (${s.plantsFit.toLocaleString()} plants).`
    };
  }

  const totalPlantsSelected = $derived(
    [...selectedSeeds.entries()]
      .filter(([, qty]) => qty > 0)
      .reduce((sum, [stockItemId, quantity]) => {
        return sum + (plantsFor(stockItemId, quantity) ?? 0);
      }, 0)
  );

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && step !== 'commit') onClose();
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div
  class="aw-backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget && step !== 'commit') onClose();
  }}
>
  <div class="aw-modal" role="dialog" aria-modal="true" aria-labelledby="aw-title">
    <header class="aw-header">
      <h2 id="aw-title">✨ Suggest seed allocation</h2>
      <button class="aw-close" type="button" aria-label="Close" onclick={onClose}>✕</button>
    </header>

    <ol class="aw-stepper" aria-label="Wizard steps">
      <li class:active={step === 'seeds'} class:done={step !== 'seeds'}>1. Seeds</li>
      <li
        class:active={step === 'blocks'}
        class:done={step === 'review' || step === 'commit'}
      >
        2. Blocks
      </li>
      <li class:active={step === 'review'} class:done={step === 'commit'}>3. Review</li>
      <li class:active={step === 'commit'}>4. Commit</li>
    </ol>

    {#if error && step !== 'commit' && step !== 'review'}
      <div class="aw-error-banner" role="alert">
        <strong>Couldn't generate plan:</strong> {error}
      </div>
    {/if}

    <div class="aw-body">
      {#if step === 'seeds'}
        <p class="aw-intro">
          Pick the seed lots you want to plant. Adjust quantity per row — defaults to on-hand.
        </p>
        {#if eligibleStock.length === 0}
          <p class="empty">No seed stock with a known crop plugin and on-hand &gt; 0.</p>
        {:else}
          <div class="aw-search-row">
            <input
              type="search"
              class="aw-search"
              placeholder="Search by variety or family…"
              aria-label="Search seed lots"
              bind:value={seedSearch}
            />
            {#if seedSearch.trim().length > 0}
              <span class="muted">
                {filteredEligibleStock.length} of {eligibleStock.length}
              </span>
            {/if}
          </div>
          {#if filteredEligibleStock.length === 0}
            <p class="empty">No seeds match “{seedSearch}”.</p>
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
                    >ⓘ</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {#each seedFamilyGroups as g (g.family ?? '__unc__')}
                  <tr class="family-row">
                    <td colspan="5">
                      <span class="family-name">{g.family ?? 'Unclassified'}</span>
                      <span class="muted">({g.items.length})</span>
                    </td>
                  </tr>
                  {#each g.items as s (s.stockItemId)}
                    {@const checked = selectedSeeds.has(s.stockItemId)}
                    {@const qty = selectedSeeds.get(s.stockItemId) ?? s.onHand}
                    {@const plants = plantsFor(s.stockItemId, qty)}
                    <tr class:row-checked={checked}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${s.shortName ?? s.displayName}`}
                          checked={checked}
                          onchange={() => toggleSeed(s)}
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
                            setSeedQuantity(s.stockItemId, Number((e.target as HTMLInputElement).value))}
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
      {:else if step === 'blocks'}
        <div class="aw-blocks-header">
          <p class="aw-intro">Pick the blocks the wizard may use.</p>
          <div class="aw-blocks-actions">
            <span class="muted">{selectedBlockIds.size} of {blocks.length} selected</span>
            <button type="button" class="aw-link" onclick={selectAllBlocks}>Select all</button>
            {#if selectedBlockIds.size > 0}
              <button type="button" class="aw-link" onclick={() => (selectedBlockIds = new Set())}>
                Clear
              </button>
            {/if}
          </div>
        </div>
        <ul class="aw-blocklist">
          {#each blocks as b (b.id)}
            {@const checked = selectedBlockIds.has(b.id)}
            {@const acresText = b.acres !== undefined ? `${b.acres.toFixed(2)} ac` : null}
            {@const sunText = b.sunExposure ? `${b.sunExposure} sun` : null}
            {@const plantingsText =
              b.plantings.length > 0
                ? `${b.plantings.length} active planting${b.plantings.length === 1 ? '' : 's'}`
                : null}
            <li class:checked>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  onchange={() => toggleBlock(b.id)}
                />
                <span class="aw-block-info">
                  <span class="aw-block-name">{b.blockLabel ?? b.name}</span>
                  <span class="aw-chips">
                    {#if acresText}<span class="aw-chip">{acresText}</span>{/if}
                    {#if sunText}<span class="aw-chip">☀ {sunText}</span>{/if}
                    {#if plantingsText}<span class="aw-chip aw-chip-warn">🌱 {plantingsText}</span>{/if}
                  </span>
                </span>
              </label>
            </li>
          {/each}
        </ul>
      {:else if step === 'review'}
        {#if loading}
          <p class="aw-loading">Generating plan…</p>
        {:else if error}
          <p class="aw-error">Error: {error}</p>
        {:else if response}
          {#if response.meta.fallback}
            <div class="aw-banner warn">
              {response.meta.fallback === 'no-api-key'
                ? 'No Anthropic API key configured — plan generated by the deterministic engine. Add a key on the Settings page to enable the AI rationale layer.'
                : 'AI output failed validation; falling back to the deterministic engine.'}
            </div>
          {/if}
          <p class="aw-rationale">{response.rationale}</p>
          <table class="aw-table">
            <thead>
              <tr>
                <th>Seed</th>
                <th>Block</th>
                <th>Plants</th>
                <th>Block fit</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {#each response.assignments as a}
                {@const key = `${a.stockItemId}:${a.blockId}`}
                {@const suff = response.sufficiency[key]}
                {@const chip = suff ? sufficiencyChip(suff) : null}
                <tr>
                  <td>{varietyDisplayFor(a.stockItemId)}</td>
                  <td>{blockNameFor(a.blockId)}</td>
                  <td>{a.plants.toLocaleString()}</td>
                  <td>
                    {#if chip}
                      <span class={`chip ${chip.cls}`} title={chip.tooltip}>{chip.label}</span>
                    {/if}
                  </td>
                  <td class="why">{response.perRowRationale[key] ?? ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>

          {#if response.advisories && response.advisories.length > 0}
            <section class="aw-advisories" aria-label="Things to consider">
              <h3>Worth considering</h3>
              <ul>
                {#each response.advisories as a}
                  <li>{a}</li>
                {/each}
              </ul>
            </section>
          {/if}

          {#if response.unplaced.length > 0}
            <h3>Unplaced</h3>
            <ul>
              {#each response.unplaced as u}
                <li>
                  {varietyDisplayFor(u.stockItemId)}: {u.quantityPlants} plants couldn't be placed.
                </li>
              {/each}
            </ul>
          {/if}

          {#if response.meta.usdEstimate > 0}
            <p class="aw-cost">
              Cost: ${response.meta.usdEstimate.toFixed(4)} ({response.meta.model})
            </p>
          {/if}
        {/if}
      {:else if step === 'commit'}
        <p class="aw-loading">
          Committing… {commitProgress.done} / {commitProgress.total}
        </p>
        <progress value={commitProgress.done} max={commitProgress.total}></progress>
        {#if commitProgress.failed.length > 0}
          <p class="aw-error">Failed: {commitProgress.failed.length}</p>
          <ul>
            {#each commitProgress.failed as f}
              <li>{f}</li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    <footer class="aw-footer">
      {#if step === 'seeds'}
        <button class="btn-secondary" onclick={onClose}>Cancel</button>
        <button
          class="btn-primary"
          disabled={[...selectedSeeds.values()].every((v) => v <= 0)}
          onclick={() => (step = 'blocks')}
        >
          Next: blocks ({totalPlantsSelected.toLocaleString()} plants)
        </button>
      {:else if step === 'blocks'}
        <button class="btn-secondary" onclick={() => (step = 'seeds')}>Back</button>
        <button
          class="btn-primary"
          disabled={selectedBlockIds.size === 0 || loading}
          onclick={generatePlan}
        >
          {loading ? 'Generating…' : `Generate plan (${selectedBlockIds.size} blocks)`}
        </button>
      {:else if step === 'review'}
        <button class="btn-secondary" onclick={() => (step = 'blocks')}>Back</button>
        <button class="btn-secondary" onclick={generatePlan} disabled={loading}>Regenerate</button>
        <button
          class="btn-primary"
          onclick={commit}
          disabled={!response || response.assignments.length === 0}
        >
          Accept all
        </button>
      {:else if step === 'commit'}
        <button
          class="btn-primary"
          onclick={onClose}
          disabled={commitProgress.done < commitProgress.total}
        >
          {commitProgress.done < commitProgress.total ? 'Committing…' : 'Done'}
        </button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .aw-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 1400;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .aw-modal {
    background: white;
    border-radius: 12px;
    width: 100%;
    max-width: 1080px;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-top: 6px solid #1f5e3a;
  }
  .aw-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.9rem 1.25rem;
    border-bottom: 1px solid #e4e9e4;
  }
  .aw-header h2 {
    margin: 0;
    font-size: 1.15rem;
    color: #1f5e3a;
  }
  .aw-close {
    background: none;
    border: none;
    font-size: 1.2rem;
    color: #666;
    min-width: 48px;
    min-height: 48px;
    border-radius: 4px;
    cursor: pointer;
  }
  .aw-stepper {
    display: flex;
    list-style: none;
    margin: 0;
    padding: 0.6rem 1.25rem;
    gap: 0.75rem;
    border-bottom: 1px solid #e4e9e4;
    background: #f8fbf9;
    color: #6a7d6a;
  }
  .aw-stepper li {
    font-size: 0.95rem;
  }
  .aw-stepper li.active {
    color: #1f5e3a;
    font-weight: 700;
  }
  .aw-stepper li.done {
    color: #1f5e3a;
    opacity: 0.6;
  }
  .aw-body {
    padding: 1rem 1.25rem;
    overflow-y: auto;
    flex: 1;
  }
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
    color: #1f5e3a;
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
    color: #1f5e3a;
    font-weight: 700;
    font-size: 0.85rem;
    text-transform: capitalize;
    padding: 0.35rem 0.75rem;
  }
  .family-row .family-name {
    margin-right: 0.4rem;
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
    color: #1f5e3a;
    outline: none;
  }
  .aw-blocks-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  .aw-blocks-header .aw-intro {
    margin: 0;
  }
  .aw-blocks-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.9rem;
  }
  .aw-blocklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.5rem;
  }
  .aw-blocklist li {
    border: 1px solid #cbd5cb;
    border-radius: 8px;
    background: white;
    transition: border-color 0.1s, background 0.1s;
  }
  .aw-blocklist li:hover {
    border-color: #1f5e3a;
  }
  .aw-blocklist li.checked {
    border-color: #1f5e3a;
    background: #f3f9f4;
  }
  .aw-blocklist label {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    padding: 0.65rem 0.8rem;
    cursor: pointer;
    width: 100%;
  }
  .aw-blocklist input[type='checkbox'] {
    margin-top: 0.15rem;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: #1f5e3a;
  }
  .aw-block-info {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
    flex: 1;
  }
  .aw-block-name {
    font-weight: 700;
    color: #1f3a26;
    font-size: 0.95rem;
    line-height: 1.2;
  }
  .aw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .aw-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.5rem;
    background: #eef4ef;
    color: #4a5d4a;
    border-radius: 999px;
    font-size: 0.78rem;
    line-height: 1.4;
    white-space: nowrap;
    text-transform: capitalize;
  }
  .aw-chip-warn {
    background: #fff1cc;
    color: #6a4f00;
  }
  .aw-link {
    background: none;
    border: none;
    color: #1f5e3a;
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
    padding: 0;
  }
  .aw-rationale {
    background: #f3f9f4;
    border-left: 3px solid #1f5e3a;
    padding: 0.75rem 1rem;
    margin: 0 0 0.75rem;
    color: #1f5e3a;
    font-size: 0.95rem;
  }
  .aw-advisories {
    background: #fff8e6;
    border-left: 3px solid #b8860b;
    padding: 0.6rem 1rem 0.75rem;
    margin: 0.75rem 0;
    color: #6a4f00;
  }
  .aw-advisories h3 {
    margin: 0 0 0.4rem;
    font-size: 0.95rem;
    color: #6a4f00;
  }
  .aw-advisories ul {
    margin: 0;
    padding-left: 1.2rem;
  }
  .aw-advisories li {
    font-size: 0.92rem;
    line-height: 1.4;
    margin-bottom: 0.25rem;
  }
  .aw-banner.warn {
    background: #fff8e6;
    border-left: 3px solid #b8860b;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    color: #6a4f00;
    font-size: 0.92rem;
  }
  .aw-error {
    color: #b22222;
    font-weight: 600;
  }
  .aw-error-banner {
    background: #fdecec;
    color: #8a1f1f;
    border-left: 3px solid #b22222;
    padding: 0.6rem 0.9rem;
    margin: 0.5rem 1.25rem 0;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .aw-error-banner strong {
    color: #6a1414;
  }
  .aw-loading {
    color: #1f5e3a;
    font-size: 1rem;
  }
  .chip {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .chip-match {
    background: #d6efdc;
    color: #1f5e3a;
  }
  .chip-surplus {
    background: #fff1cc;
    color: #6a4f00;
  }
  .chip-deficit {
    background: #f9d6d6;
    color: #8a1f1f;
  }
  .why {
    color: #4a5d4a;
    font-size: 0.9rem;
    max-width: 22rem;
  }
  .aw-cost {
    color: #6a7d6a;
    font-size: 0.85rem;
    text-align: right;
  }
  .aw-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid #e4e9e4;
    background: #fafcfa;
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
    background: #1f5e3a;
    color: white;
    border-color: #1f5e3a;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: white;
    color: #4a5d4a;
  }
  progress {
    width: 100%;
    height: 14px;
    margin-top: 0.5rem;
  }
  .empty {
    color: #6a7d6a;
    font-style: italic;
  }
</style>
