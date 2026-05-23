<script lang="ts">
  import { page } from '$app/stores';
  import { untrack } from 'svelte';
  import {
    cellCountRecommendation,
    inferSeedTypeFromName,
    matchPlates,
    mmToInternal
  } from '$lib/planterPlate/match';
  import type { Plate, PlateSeedType } from '$lib/planterPlate/types';
  import { MM_TO_64THS } from '$lib/planterPlate/types';

  let { data } = $props();

  const plates = $derived(data.plates as Plate[]);

  // Context item — when ?stockId=... is supplied and matches a seed item.
  const ctx = $derived(data.contextItem);

  // Saved config (if pre-filled from a stock item).
  const saved = $derived.by(() => {
    if (!ctx?.metadataJson) return null;
    try {
      const parsed = JSON.parse(ctx.metadataJson);
      return parsed?.planterPlateConfig ?? null;
    } catch {
      return null;
    }
  });
  const seedMeta = $derived.by<Record<string, unknown> | null>(() => {
    if (!ctx?.metadataJson) return null;
    try {
      return JSON.parse(ctx.metadataJson) as Record<string, unknown>;
    } catch {
      return null;
    }
  });

  const round1 = (n: number) => Math.round(n * 10) / 10;

  // Query params for deep-linking (e.g., from an AI suggestion).
  const qp = (k: string): string | null => $page.url.searchParams.get(k);
  const qpNum = (k: string): number | undefined => {
    const v = qp(k);
    if (v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  // Filters — seed type prefers saved → query param → inferred from taxonomy
  let seedType = $state<PlateSeedType | ''>(
    untrack(() => {
      const fromSaved = saved?.seedType as PlateSeedType | undefined;
      if (fromSaved) return fromSaved;
      const fromQuery = qp('seedType') as PlateSeedType | null;
      if (fromQuery) return fromQuery;
      return ctx?.inferredSeedType ?? '';
    })
  );
  let series = $state<'B' | 'C' | 'Both'>(
    untrack(() => (saved?.series === 'B' || saved?.series === 'C' ? saved.series : 'Both'))
  );
  let shape = $state<'Round' | 'Flat' | 'Either' | ''>('Either');
  let cellFilter = $state<'16' | '24' | 'Either' | '20' | '22' | '30' | '32' | '38' | '60'>(
    'Either'
  );

  // Dimension unit + values. Lookup priority:
  //   1. saved planterPlateConfig.seedDimensions (selector's own prior state).
  //   2. metadataJson.seedDimensionsMm — AI-applied kernel size from
  //      Refresh review. Stored in mm.
  //   3. Query params (?l, ?d, ?t).
  const initialDimUnit = untrack<'mm' | '64ths'>(() =>
    saved?.seedDimensions?.unit === '64ths' ? '64ths' : 'mm'
  );
  function aiSeedDims(): { L: number; D: number; T: number } | null {
    const v = seedMeta?.seedDimensionsMm as { L?: unknown; D?: unknown; T?: unknown } | undefined;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.L !== 'number' || typeof v.D !== 'number' || typeof v.T !== 'number') return null;
    return { L: v.L, D: v.D, T: v.T };
  }
  function pickDisplay(displayKey: string, canonKey: 'L' | 'D' | 'T'): number | undefined {
    const d = saved?.seedDimensions?.[displayKey];
    if (typeof d === 'number') return d;
    const c = saved?.seedDimensions?.[canonKey];
    if (typeof c === 'number') return initialDimUnit === 'mm' ? round1(c / MM_TO_64THS) : c;
    const ai = aiSeedDims();
    if (ai) {
      const valMm = ai[canonKey];
      return initialDimUnit === 'mm' ? valMm : round1(valMm * MM_TO_64THS);
    }
    return undefined;
  }
  let dimUnit = $state<'mm' | '64ths'>(initialDimUnit);
  let seedL = $state<number | undefined>(untrack(() => pickDisplay('displayL', 'L') ?? qpNum('l')));
  let seedD = $state<number | undefined>(untrack(() => pickDisplay('displayD', 'D') ?? qpNum('d')));
  let seedT = $state<number | undefined>(untrack(() => pickDisplay('displayT', 'T') ?? qpNum('t')));
  let tolerance = $state<number>(
    untrack(() => {
      const td = saved?.seedDimensions?.displayTolerance;
      return typeof td === 'number' ? td : 1;
    })
  );

  // If the AI also returned a seedShape, use it as the initial selection
  // (only meaningful for Corn/Soybean). Set after `shape` is declared.
  const aiSeedShape = untrack(() => {
    const v = seedMeta?.seedShape;
    return v === 'Round' || v === 'Flat' ? v : null;
  });
  if (aiSeedShape) shape = aiSeedShape;

  function toggleUnit(next: 'mm' | '64ths') {
    if (next === dimUnit) return;
    const factor = next === 'mm' ? 1 / MM_TO_64THS : MM_TO_64THS;
    if (seedL !== undefined) seedL = round1(seedL * factor);
    if (seedD !== undefined) seedD = round1(seedD * factor);
    if (seedT !== undefined) seedT = round1(seedT * factor);
    dimUnit = next;
  }

  // Density inputs for the cell-count recommendation (Corn).
  let targetInRowSpacing = $state<number | undefined>(
    untrack(() => {
      const fromSaved = saved?.density?.inRowInches as number | undefined;
      if (typeof fromSaved === 'number') return fromSaved;
      const m = seedMeta?.spacingInches;
      return typeof m === 'number' ? m : undefined;
    })
  );
  let targetRowSpacing = $state<number>(
    untrack(() => (saved?.density?.rowInches as number | undefined) ?? 30)
  );

  const cellRec = $derived(
    seedType === 'Corn' ? cellCountRecommendation(targetInRowSpacing, targetRowSpacing) : null
  );
  const plantsPerAcre = $derived(cellRec?.plantsPerAcre ?? null);

  let didInitialAutoApply = $state<boolean>(untrack(() => !!saved));
  $effect(() => {
    if (didInitialAutoApply) return;
    if (!cellRec) return;
    cellFilter = String(cellRec.cells) as '16' | '24';
    didInitialAutoApply = true;
  });

  function applyRecommendation() {
    if (cellRec) {
      cellFilter = String(cellRec.cells) as '16' | '24';
      didInitialAutoApply = true;
    }
  }

  const showShape = $derived(seedType === 'Corn' || seedType === 'Soybean');
  const showSorghumCells = $derived(seedType === 'Sorghum');
  const showSoybeanCells = $derived(seedType === 'Soybean');
  const showCellRec = $derived(seedType === 'Corn');
  const dimsProvided = $derived(seedL !== undefined && seedD !== undefined && seedT !== undefined);
  const seedL64 = $derived(
    seedL === undefined ? undefined : dimUnit === 'mm' ? mmToInternal(seedL) : seedL
  );
  const seedD64 = $derived(
    seedD === undefined ? undefined : dimUnit === 'mm' ? mmToInternal(seedD) : seedD
  );
  const seedT64 = $derived(
    seedT === undefined ? undefined : dimUnit === 'mm' ? mmToInternal(seedT) : seedT
  );
  const tolerance64 = $derived(dimUnit === 'mm' ? mmToInternal(tolerance) : tolerance);

  $effect(() => {
    const validCells: string[] = ['16', '24', 'Either'];
    if (showSorghumCells) validCells.push('30', '60');
    if (showSoybeanCells) validCells.push('20', '22', '32', '38');
    if (!validCells.includes(cellFilter)) cellFilter = 'Either';
    if (!showShape && shape !== 'Either') shape = 'Either';
  });

  let searched = $state(false);
  const results = $derived.by(() => {
    if (!searched || !seedType) return [];
    return matchPlates(plates, {
      seedType: seedType as PlateSeedType,
      series,
      shape: showShape ? (shape === '' ? 'Either' : shape) : 'Either',
      cells: cellFilter === 'Either' ? 'Either' : Number(cellFilter),
      dimensions: dimsProvided
        ? { L: seedL64 as number, D: seedD64 as number, T: seedT64 as number }
        : undefined,
      toleranceInternal: tolerance64
    });
  });

  function find() {
    if (!seedType) return;
    searched = true;
  }
  function printResults() {
    if (typeof window !== 'undefined') window.print();
  }

  // Save-to-seed-lot — defaults to the context item when provided.
  let saveTargetId = $state<string>(untrack(() => ctx?.id ?? ''));

  const KNOWN_COLOR = new Set([
    'red',
    'blue',
    'green',
    'yellow',
    'orange',
    'pink',
    'gold',
    'silver',
    'gray',
    'grey',
    'white',
    'maroon',
    'olive',
    'turquoise',
    'tan',
    'ivory',
    'violet',
    'coral',
    'brown'
  ]);
  const COLOR_MAP: Record<string, string> = {
    'Dk. Blue': '#1a3a7a',
    'Lt. Blue': '#7ec0ee',
    'Med. Blue': '#3b7dd8',
    'Dk. Green': '#1f5e3a',
    'Lt. Green': '#9fd99f',
    'Med. Green': '#3fa75f',
    'Yel. Green': '#b8d63e',
    'Lt. Gold': '#e3c97a',
    'Lt. Yellow': '#fff5a8',
    'Med. Violet': '#9a5acb',
    'Red-Orange': '#e34a1d',
    'Orange-Red': '#e34a1d',
    Avocado: '#6c8a2e',
    Rust: '#b7410e'
  };
  function colorSwatch(name: string): string {
    if (COLOR_MAP[name]) return COLOR_MAP[name];
    const k = name.toLowerCase();
    if (KNOWN_COLOR.has(k)) return k;
    return '#cccccc';
  }
</script>

<svelte:head><title>Planter Plate Selector — CropCard</title></svelte:head>

<header class="head">
  {#if ctx}
    <a href="/stock" class="back">← Back to inventory</a>
  {:else}
    <a href="/tools" class="back">← Tools</a>
  {/if}
  <h1>Planter Plate Selector</h1>
  {#if ctx}
    <p class="subtitle">
      Pre-filled for <strong>{ctx.displayName}</strong>. Save will write back to this seed record.
    </p>
  {:else}
    <p class="subtitle">
      Match a Lincoln Ag plate (John Deere "B" / IHC "C") to your seed by type, shape, cell count,
      and (optionally) dimensions. Save the result to any seed lot when you're done.
    </p>
  {/if}
</header>

<section class="card form-panel" aria-labelledby="filters-h">
  <h2 id="filters-h">Filters</h2>

  <fieldset>
    <legend>Planter brand / plate series</legend>
    <div class="radios">
      <label><input type="radio" bind:group={series} value="B" /> John Deere (B)</label>
      <label><input type="radio" bind:group={series} value="C" /> International Harvester (C)</label
      >
      <label><input type="radio" bind:group={series} value="Both" /> Both</label>
    </div>
  </fieldset>

  <label class="block">
    <span>Seed type</span>
    <select bind:value={seedType}>
      <option value="">— pick one —</option>
      <option value="Corn">Corn</option>
      <option value="Sorghum">Sorghum</option>
      <option value="Soybean">Soybean</option>
      <option value="Sunflower">Sunflower</option>
      <option value="Sugar Beet">Sugar Beet</option>
    </select>
  </label>

  {#if showShape}
    <fieldset>
      <legend>Cell type / seed shape</legend>
      <div class="radios">
        <label><input type="radio" bind:group={shape} value="Round" /> Round seed</label>
        <label><input type="radio" bind:group={shape} value="Flat" /> Flat seed</label>
        <label><input type="radio" bind:group={shape} value="Either" /> Either / Unknown</label>
      </div>
    </fieldset>
  {/if}

  <fieldset>
    <legend>
      Number of cells
      {#if showCellRec && cellRec && cellFilter === String(cellRec.cells) && plantsPerAcre !== null}
        <span class="rec-inline" title={cellRec.note}
          >· suggested ({plantsPerAcre.toLocaleString()} plants/acre)</span
        >
      {/if}
    </legend>
    <div class="radios">
      <label><input type="radio" bind:group={cellFilter} value="16" /> 16 cell</label>
      <label><input type="radio" bind:group={cellFilter} value="24" /> 24 cell</label>
      {#if showSorghumCells}
        <label><input type="radio" bind:group={cellFilter} value="30" /> 30 cell</label>
        <label><input type="radio" bind:group={cellFilter} value="60" /> 60 cell</label>
      {/if}
      {#if showSoybeanCells}
        <label><input type="radio" bind:group={cellFilter} value="20" /> 20 cell</label>
        <label><input type="radio" bind:group={cellFilter} value="22" /> 22 cell</label>
        <label><input type="radio" bind:group={cellFilter} value="32" /> 32 cell</label>
        <label><input type="radio" bind:group={cellFilter} value="38" /> 38 cell</label>
      {/if}
      <label><input type="radio" bind:group={cellFilter} value="Either" /> Either</label>
    </div>
    {#if showCellRec}
      <details class="density-disclosure">
        <summary>Why this suggestion? (target density)</summary>
        <p class="hint">
          For corn, a 24-cell plate plants 1.5× as many seeds/acre as a 16-cell at the same
          sprocket. Plants/acre is computed from the spacings below; the threshold (≤22k → 16-cell,
          ≥22k → 24-cell) is a heuristic — it picks the cell-count family, not the sprocket itself.
        </p>
        <div class="row2">
          <label
            ><span>In-row spacing (in)</span><input
              type="number"
              min="0.5"
              step="0.5"
              bind:value={targetInRowSpacing}
              placeholder="e.g. 7.5"
            /></label
          >
          <label
            ><span>Row spacing (in)</span><input
              type="number"
              min="6"
              step="1"
              bind:value={targetRowSpacing}
              placeholder="30"
            /></label
          >
        </div>
        {#if cellRec && plantsPerAcre !== null}
          <p class="rec-line rec-{cellRec.band}">
            <strong
              >{plantsPerAcre.toLocaleString()} plants/acre → suggests {cellRec.cells}-cell.</strong
            >
            <span>{cellRec.note}</span>
            {#if cellFilter !== String(cellRec.cells)}
              <button type="button" class="link-btn" onclick={applyRecommendation}>Apply</button>
            {/if}
          </p>
        {/if}
      </details>
    {/if}
  </fieldset>

  <fieldset class="dims">
    <legend>
      Seed dimensions <span class="opt">(optional)</span>
      <button
        type="button"
        class="help"
        aria-label="Dimensions help"
        title="L = Length, D = Depth, T = Thickness. Toggle between mm and 64ths of an inch."
        >?</button
      >
    </legend>
    <div class="unit-toggle" role="group" aria-label="Dimension unit">
      <button
        type="button"
        class="unit-btn"
        class:active={dimUnit === 'mm'}
        onclick={() => toggleUnit('mm')}>mm</button
      >
      <button
        type="button"
        class="unit-btn"
        class:active={dimUnit === '64ths'}
        onclick={() => toggleUnit('64ths')}>64ths in.</button
      >
    </div>
    <p class="hint">
      Format: L-D-T (e.g., {dimUnit === 'mm' ? '12-9-5 mm' : '30-23-13 (64ths)'}). Leave blank to
      see all plates for selected type.
    </p>
    <div class="row3">
      <label
        ><span>L (Length, {dimUnit})</span><input
          type="number"
          min="0"
          step={dimUnit === 'mm' ? '0.1' : '0.5'}
          bind:value={seedL}
        /></label
      >
      <label
        ><span>D (Depth, {dimUnit})</span><input
          type="number"
          min="0"
          step={dimUnit === 'mm' ? '0.1' : '0.5'}
          bind:value={seedD}
        /></label
      >
      <label
        ><span>T (Thickness, {dimUnit})</span><input
          type="number"
          min="0"
          step={dimUnit === 'mm' ? '0.1' : '0.5'}
          bind:value={seedT}
        /></label
      >
    </div>
    <label class="block">
      <span>Tolerance: ±{tolerance} {dimUnit} per dimension</span>
      <input
        type="range"
        min="0"
        max={dimUnit === 'mm' ? 3 : 5}
        step={dimUnit === 'mm' ? 0.5 : 1}
        bind:value={tolerance}
      />
    </label>
  </fieldset>

  <button type="button" class="primary" onclick={find} disabled={!seedType}>Find plates</button>
</section>

<section class="card results-panel" aria-labelledby="results-h">
  <div class="results-head">
    <h2 id="results-h">Results</h2>
    <button
      type="button"
      class="secondary print-btn"
      onclick={printResults}
      disabled={!searched || results.length === 0}>Print results</button
    >
  </div>

  {#if !searched}
    <p class="empty" aria-live="polite">Select a seed type above to get started.</p>
  {:else}
    {#if seedType === 'Sugar Beet'}
      <p class="warn-banner" role="alert">
        ⚠️ Sugar Beet plates require a Sugar Beet bottom — incompatible with standard corn planters.
      </p>
    {/if}
    <p class="count" aria-live="polite">
      {results.length}
      {results.length === 1 ? 'plate' : 'plates'} found
      {#if results.length === 20}{' '}(showing first 20){/if}
    </p>
    {#if results.length === 0}
      <p class="empty">No plates found — try widening your tolerance or clearing filters.</p>
    {:else}
      <ul class="cards">
        {#each results as p (p.plateNumber)}
          <li class="plate-card">
            <header>
              <span class="plate-num">{p.plateNumber}</span>
              <span class="color-badge">
                <span class="swatch" style="background:{colorSwatch(p.color)}"></span>{p.color}
              </span>
            </header>
            <dl>
              <div>
                <dt>Dimensions</dt>
                <dd>{p.dimensions} <small>(L-D-T, 64ths in)</small></dd>
              </div>
              {#if p.shape}<div>
                  <dt>Shape</dt>
                  <dd><span class="badge shape-{p.shape.toLowerCase()}">{p.shape}</span></dd>
                </div>{/if}
              <div>
                <dt>Cells</dt>
                <dd>{p.cells}</dd>
              </div>
              <div>
                <dt>Series</dt>
                <dd>{p.series === 'B' ? 'John Deere (B)' : 'IHC (C)'}</dd>
              </div>
              <div>
                <dt>Seed type</dt>
                <dd>{p.seedType}</dd>
              </div>
              {#if p.seedType === 'Corn' && p.gradeSize}<div>
                  <dt>Grade</dt>
                  <dd><span class="badge grade">{p.gradeSize}</span></dd>
                </div>{/if}
              {#if p.seedType === 'Sorghum' && p.notes}<div>
                  <dt>Seeds/lb</dt>
                  <dd>{p.notes}</dd>
                </div>{/if}
              {#if p.seedType === 'Soybean' && p.notes}<div>
                  <dt>Notes</dt>
                  <dd>{p.notes}</dd>
                </div>{/if}
              {#if 'delta' in p && p.delta !== undefined}<div>
                  <dt>Match score</dt>
                  <dd><strong>Δ = {p.delta}</strong></dd>
                </div>{/if}
            </dl>

            {#if data.canEdit && p.seedType !== 'Sugar Beet' && data.seedItems.length > 0}
              <form method="POST" action="?/saveToStock" class="save-form">
                <label class="save-target">
                  <span>Save to seed:</span>
                  <select name="stockId" bind:value={saveTargetId} required>
                    <option value="">— choose a seed lot —</option>
                    {#each data.seedItems as si (si.id)}
                      <option value={si.id}>{si.displayName}</option>
                    {/each}
                  </select>
                </label>
                <input type="hidden" name="plateNumber" value={p.plateNumber} />
                <input type="hidden" name="series" value={p.series} />
                <input type="hidden" name="brand" value={p.brand} />
                <input type="hidden" name="cells" value={p.cells} />
                <input type="hidden" name="color" value={p.color} />
                <input type="hidden" name="dimensions" value={p.dimensions} />
                <input type="hidden" name="L" value={p.L} />
                <input type="hidden" name="D" value={p.D} />
                <input type="hidden" name="T" value={p.T} />
                <input type="hidden" name="shape" value={p.shape} />
                <input type="hidden" name="seedType" value={p.seedType} />
                <input type="hidden" name="gradeSize" value={p.gradeSize} />
                {#if seedL64 !== undefined}<input type="hidden" name="seedL" value={seedL64} />{/if}
                {#if seedD64 !== undefined}<input type="hidden" name="seedD" value={seedD64} />{/if}
                {#if seedT64 !== undefined}<input type="hidden" name="seedT" value={seedT64} />{/if}
                <input type="hidden" name="tolerance" value={tolerance64} />
                <input type="hidden" name="dimUnit" value={dimUnit} />
                {#if seedL !== undefined}<input
                    type="hidden"
                    name="seedLDisplay"
                    value={seedL}
                  />{/if}
                {#if seedD !== undefined}<input
                    type="hidden"
                    name="seedDDisplay"
                    value={seedD}
                  />{/if}
                {#if seedT !== undefined}<input
                    type="hidden"
                    name="seedTDisplay"
                    value={seedT}
                  />{/if}
                <input type="hidden" name="toleranceDisplay" value={tolerance} />
                {#if targetInRowSpacing !== undefined}<input
                    type="hidden"
                    name="inRowInches"
                    value={targetInRowSpacing}
                  />{/if}
                <input type="hidden" name="rowInches" value={targetRowSpacing} />
                {#if plantsPerAcre !== null}<input
                    type="hidden"
                    name="plantsPerAcre"
                    value={plantsPerAcre}
                  />{/if}
                <button type="submit" class="primary save" disabled={!saveTargetId}
                  >Save to seed record</button
                >
              </form>
            {:else if data.canEdit && data.seedItems.length === 0}
              <p class="empty save-empty">No seed inventory yet — add a seed to /stock to save.</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<footer class="foot">Data sourced from Lincoln Ag Products.</footer>

<style>
  .head .back {
    color: #1f5e3a;
    text-decoration: none;
    font-weight: 600;
    display: inline-block;
    margin-bottom: 0.5rem;
  }
  .head h1 {
    margin: 0 0 0.25rem;
  }
  .subtitle {
    color: #555;
    margin: 0 0 1rem;
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
  fieldset {
    border: 1px solid #d0d7d0;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin: 0 0 0.75rem;
  }
  legend {
    font-size: 0.8rem;
    color: #1f5e3a;
    font-weight: 700;
    text-transform: uppercase;
    padding: 0 0.25rem;
  }
  legend .opt {
    color: #777;
    font-weight: 400;
    text-transform: none;
  }
  .radios {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1rem;
  }
  .radios label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.95rem;
    min-height: 48px;
  }
  label.block {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }
  label.block > span {
    font-size: 0.85rem;
    color: #444;
  }
  select,
  input[type='number'],
  input[type='range'] {
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  input[type='range'] {
    padding: 0;
  }
  .dims .row3,
  .row2 {
    display: grid;
    gap: 0.5rem;
  }
  .dims .row3 {
    grid-template-columns: repeat(3, 1fr);
  }
  .row2 {
    grid-template-columns: repeat(2, 1fr);
  }
  .dims .row3 label,
  .row2 label {
    display: flex;
    flex-direction: column;
    font-size: 0.85rem;
    gap: 0.25rem;
  }
  .unit-toggle {
    display: inline-flex;
    border: 1px solid #d0d7d0;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.4rem;
  }
  .unit-btn {
    background: white;
    border: none;
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 36px;
    color: #444;
    border-right: 1px solid #d0d7d0;
  }
  .unit-btn:last-child {
    border-right: none;
  }
  .unit-btn.active {
    background: #1f5e3a;
    color: white;
    font-weight: 600;
  }
  .hint {
    color: #555;
    font-size: 0.85rem;
    margin: 0 0 0.5rem;
  }
  .help {
    border: 1px solid #1f5e3a;
    background: white;
    color: #1f5e3a;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    font-weight: 700;
    cursor: help;
    margin-left: 0.25rem;
    line-height: 1;
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
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .secondary {
    background: white;
    color: #1f5e3a;
    border: 2px solid #1f5e3a;
    border-radius: 6px;
    padding: 0.5rem 1rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 40px;
  }
  .secondary:disabled {
    color: #999;
    border-color: #999;
    cursor: not-allowed;
  }
  .rec-inline {
    font-weight: 400;
    font-size: 0.75rem;
    color: #555;
    text-transform: none;
    letter-spacing: 0;
    margin-left: 0.4rem;
  }
  .density-disclosure {
    margin-top: 0.5rem;
    border-top: 1px dashed #d0d7d0;
    padding-top: 0.5rem;
  }
  .density-disclosure summary {
    cursor: pointer;
    font-size: 0.85rem;
    color: #1f5e3a;
    user-select: none;
  }
  .density-disclosure summary:hover {
    text-decoration: underline;
  }
  .density-disclosure .hint {
    margin: 0.5rem 0;
  }
  .rec-line {
    margin: 0.5rem 0 0;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    background: #f8fbf9;
    border-left: 3px solid #1f5e3a;
    font-size: 0.9rem;
  }
  .rec-line.rec-low {
    border-left-color: #b35900;
  }
  .rec-line.rec-mid {
    border-left-color: #6b7280;
  }
  .rec-line.rec-high {
    border-left-color: #1f5e3a;
  }
  .rec-line strong {
    display: block;
    color: #1f5e3a;
    margin-bottom: 0.1rem;
  }
  .rec-line span {
    display: block;
    color: #555;
    font-size: 0.85rem;
  }
  .link-btn {
    background: none;
    border: none;
    color: #1f5e3a;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
    font-size: 0.85rem;
    margin-top: 0.25rem;
  }
  .results-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .count {
    color: #444;
    font-size: 0.9rem;
    margin: 0 0 0.75rem;
  }
  .empty {
    color: #555;
    font-style: italic;
  }
  .warn-banner {
    background: #fff8ec;
    border: 2px solid #b35900;
    color: #6b3a00;
    padding: 0.6rem 0.9rem;
    border-radius: 6px;
    font-weight: 600;
  }
  .cards {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.75rem;
  }
  .plate-card {
    background: #f8fbf9;
    border: 1px solid #d0d7d0;
    border-left: 4px solid #1f5e3a;
    border-radius: 6px;
    padding: 0.75rem 0.9rem;
  }
  .plate-card header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .plate-num {
    font-size: 1.4rem;
    font-weight: 800;
    font-family: monospace;
    color: #1f5e3a;
  }
  .color-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: white;
    border: 1px solid #d0d7d0;
    border-radius: 999px;
    padding: 0.15rem 0.5rem 0.15rem 0.15rem;
    font-size: 0.8rem;
    color: #333;
  }
  .swatch {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.25);
  }
  .plate-card dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 0.75rem;
    margin: 0 0 0.6rem;
    font-size: 0.9rem;
  }
  .plate-card dl > div {
    display: contents;
  }
  .plate-card dt {
    color: #666;
  }
  .plate-card dd {
    margin: 0;
  }
  .plate-card dd small {
    color: #888;
  }
  .badge {
    display: inline-block;
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.05rem 0.45rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .badge.shape-flat {
    background: #f0e9ff;
    color: #4a2d8a;
  }
  .badge.shape-round {
    background: #fef0e0;
    color: #8a4a14;
  }
  .badge.grade {
    background: #fffae5;
    color: #6b5500;
  }
  .save-form {
    margin: 0;
  }
  .save-target {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
    color: #555;
    margin-bottom: 0.4rem;
  }
  .save-target select {
    font-size: 0.9rem;
    min-height: 40px;
    padding: 0.4rem;
  }
  .save {
    width: 100%;
  }
  .save-empty {
    font-size: 0.85rem;
  }
  .foot {
    text-align: center;
    color: #777;
    font-size: 0.85rem;
    padding: 1rem 0 2rem;
  }
  @media print {
    .head .back,
    .form-panel,
    .print-btn,
    .save-form,
    .foot {
      display: none !important;
    }
    .card {
      box-shadow: none;
      border: 1px solid #ccc;
    }
    .cards {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
