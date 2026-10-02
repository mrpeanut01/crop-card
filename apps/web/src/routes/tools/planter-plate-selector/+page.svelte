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
  import UnitInput from '$lib/components/ui/UnitInput.svelte';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import { createT } from '$lib/i18n';

  let { data } = $props();
  const tr = $derived(createT(data.locale));
  const SEED_TYPE_KEYS = {
    Corn: 'tools.plate.type.Corn',
    Sorghum: 'tools.plate.type.Sorghum',
    Soybean: 'tools.plate.type.Soybean',
    Sunflower: 'tools.plate.type.Sunflower',
    'Sugar Beet': 'tools.plate.type.SugarBeet'
  } as const;
  const seedTypeLabel = (s: string): string =>
    s in SEED_TYPE_KEYS ? tr(SEED_TYPE_KEYS[s as keyof typeof SEED_TYPE_KEYS]) : s;

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
  let targetInRowSpacing = $state<number | null>(
    untrack(() => {
      const fromSaved = saved?.density?.inRowInches as number | undefined;
      if (typeof fromSaved === 'number') return fromSaved;
      const m = seedMeta?.spacingInches;
      return typeof m === 'number' ? m : null;
    })
  );
  let targetRowSpacing = $state<number | null>(
    untrack(() => (saved?.density?.rowInches as number | undefined) ?? 30)
  );

  const cellRec = $derived(
    seedType === 'Corn'
      ? cellCountRecommendation(
          targetInRowSpacing ?? undefined,
          targetRowSpacing ?? undefined,
          currentPrefs()
        )
      : null
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

<svelte:head><title>{tr('tools.plate.title')} — CropCard</title></svelte:head>

<header class="head">
  {#if ctx}
    <a href="/inventory?type=seed" class="back">{tr('tools.plate.backInventory')}</a>
  {:else}
    <a href="/tools" class="back">{tr('tools.plate.backTools')}</a>
  {/if}
  <h1>{tr('tools.plate.title')}</h1>
  {#if ctx}
    <p class="subtitle">
      {tr('tools.plate.prefilled')} <strong>{ctx.displayName}</strong>{tr(
        'tools.plate.prefilledEnd'
      )}
    </p>
  {:else}
    <p class="subtitle">
      {tr('tools.plate.lede')}
    </p>
  {/if}
</header>

<section class="card form-panel" aria-labelledby="filters-h">
  <h2 id="filters-h">{tr('tools.plate.filters')}</h2>

  <fieldset>
    <legend>{tr('tools.plate.series')}</legend>
    <div class="radios">
      <label><input type="radio" bind:group={series} value="B" /> {tr('tools.plate.jd')}</label>
      <label><input type="radio" bind:group={series} value="C" /> {tr('tools.plate.ih')}</label>
      <label><input type="radio" bind:group={series} value="Both" /> {tr('tools.plate.both')}</label
      >
    </div>
  </fieldset>

  <label class="block">
    <span>{tr('tools.plate.seedType')}</span>
    <select bind:value={seedType}>
      <option value="">{tr('tools.plate.pickOne')}</option>
      <option value="Corn">{seedTypeLabel('Corn')}</option>
      <option value="Sorghum">{seedTypeLabel('Sorghum')}</option>
      <option value="Soybean">{seedTypeLabel('Soybean')}</option>
      <option value="Sunflower">{seedTypeLabel('Sunflower')}</option>
      <option value="Sugar Beet">{seedTypeLabel('Sugar Beet')}</option>
    </select>
  </label>

  {#if showShape}
    <fieldset>
      <legend>{tr('tools.plate.shapeLegend')}</legend>
      <div class="radios">
        <label
          ><input type="radio" bind:group={shape} value="Round" />
          {tr('tools.plate.roundSeed')}</label
        >
        <label
          ><input type="radio" bind:group={shape} value="Flat" />
          {tr('tools.plate.flatSeed')}</label
        >
        <label
          ><input type="radio" bind:group={shape} value="Either" />
          {tr('tools.plate.eitherUnknown')}</label
        >
      </div>
    </fieldset>
  {/if}

  <fieldset>
    <legend>
      {tr('tools.plate.cellsLegend')}
      {#if showCellRec && cellRec && cellFilter === String(cellRec.cells) && plantsPerAcre !== null}
        <span class="rec-inline" title={cellRec.note}
          >· {tr('tools.plate.suggested')} ({fmt.qty(plantsPerAcre, 'perArea', { bare: true })}
          {tr('tools.plate.plants')}{fmt.unit('perArea')})</span
        >
      {/if}
    </legend>
    <div class="radios">
      <label
        ><input type="radio" bind:group={cellFilter} value="16" />
        {tr('tools.plate.cell', { n: 16 })}</label
      >
      <label
        ><input type="radio" bind:group={cellFilter} value="24" />
        {tr('tools.plate.cell', { n: 24 })}</label
      >
      {#if showSorghumCells}
        <label
          ><input type="radio" bind:group={cellFilter} value="30" />
          {tr('tools.plate.cell', { n: 30 })}</label
        >
        <label
          ><input type="radio" bind:group={cellFilter} value="60" />
          {tr('tools.plate.cell', { n: 60 })}</label
        >
      {/if}
      {#if showSoybeanCells}
        <label
          ><input type="radio" bind:group={cellFilter} value="20" />
          {tr('tools.plate.cell', { n: 20 })}</label
        >
        <label
          ><input type="radio" bind:group={cellFilter} value="22" />
          {tr('tools.plate.cell', { n: 22 })}</label
        >
        <label
          ><input type="radio" bind:group={cellFilter} value="32" />
          {tr('tools.plate.cell', { n: 32 })}</label
        >
        <label
          ><input type="radio" bind:group={cellFilter} value="38" />
          {tr('tools.plate.cell', { n: 38 })}</label
        >
      {/if}
      <label
        ><input type="radio" bind:group={cellFilter} value="Either" />
        {tr('tools.plate.either')}</label
      >
    </div>
    {#if showCellRec}
      <details class="density-disclosure">
        <summary>{tr('tools.plate.why')}</summary>
        <p class="hint">
          {tr('tools.plate.density', {
            unit: fmt.unit('perArea'),
            k: Math.round(fmt.toDisplay(22_000, 'perArea') / 1000)
          })}
        </p>
        <div class="row2">
          <label
            ><span>{tr('tools.plate.inRow', { unit: fmt.unit('length') })}</span><UnitInput
              quantity="length"
              min={0.5}
              suffix={false}
              bind:value={targetInRowSpacing}
              placeholder={fmt.qty(7.5, 'length', { bare: true })}
            /></label
          >
          <label
            ><span>{tr('tools.plate.rowSpacing', { unit: fmt.unit('length') })}</span><UnitInput
              quantity="length"
              min={6}
              suffix={false}
              bind:value={targetRowSpacing}
              placeholder={fmt.qty(30, 'length', { bare: true })}
            /></label
          >
        </div>
        {#if cellRec && plantsPerAcre !== null}
          <p class="rec-line rec-{cellRec.band}">
            <strong
              >{fmt.qty(plantsPerAcre, 'perArea', { bare: true })}
              {tr('tools.plate.plants')}{fmt.unit('perArea')} → {tr('tools.plate.suggests', {
                cells: cellRec.cells
              })}</strong
            >
            <span>{cellRec.note}</span>
            {#if cellFilter !== String(cellRec.cells)}
              <button type="button" class="link-btn" onclick={applyRecommendation}
                >{tr('tools.plate.apply')}</button
              >
            {/if}
          </p>
        {/if}
      </details>
    {/if}
  </fieldset>

  <fieldset class="dims">
    <legend>
      {tr('tools.plate.dims')} <span class="opt">{tr('tools.plate.optional')}</span>
      <button
        type="button"
        class="help"
        aria-label={tr('tools.plate.dimsHelp')}
        title={tr('tools.plate.dimsHelpTitle')}>?</button
      >
    </legend>
    <div class="unit-toggle" role="group" aria-label={tr('tools.plate.dimUnit')}>
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
        onclick={() => toggleUnit('64ths')}>{tr('tools.plate.64ths')}</button
      >
    </div>
    <p class="hint">
      {tr('tools.plate.format', {
        example: dimUnit === 'mm' ? '12-9-5 mm' : '30-23-13 (64ths)'
      })}
    </p>
    <div class="row3">
      <label
        ><span>{tr('tools.plate.lenL', { unit: dimUnit })}</span><input
          type="number"
          min="0"
          step={dimUnit === 'mm' ? '0.1' : '0.5'}
          bind:value={seedL}
        /></label
      >
      <label
        ><span>{tr('tools.plate.depD', { unit: dimUnit })}</span><input
          type="number"
          min="0"
          step={dimUnit === 'mm' ? '0.1' : '0.5'}
          bind:value={seedD}
        /></label
      >
      <label
        ><span>{tr('tools.plate.thkT', { unit: dimUnit })}</span><input
          type="number"
          min="0"
          step={dimUnit === 'mm' ? '0.1' : '0.5'}
          bind:value={seedT}
        /></label
      >
    </div>
    <label class="block">
      <span>{tr('tools.plate.tolerance', { tol: tolerance, unit: dimUnit })}</span>
      <input
        type="range"
        min="0"
        max={dimUnit === 'mm' ? 3 : 5}
        step={dimUnit === 'mm' ? 0.5 : 1}
        bind:value={tolerance}
      />
    </label>
  </fieldset>

  <button type="button" class="primary" onclick={find} disabled={!seedType}
    >{tr('tools.plate.find')}</button
  >
</section>

<section class="card results-panel" aria-labelledby="results-h">
  <div class="results-head">
    <h2 id="results-h">{tr('tools.plate.results')}</h2>
    <button
      type="button"
      class="secondary print-btn"
      onclick={printResults}
      disabled={!searched || results.length === 0}>{tr('tools.plate.print')}</button
    >
  </div>

  {#if !searched}
    <p class="empty" aria-live="polite">{tr('tools.plate.start')}</p>
  {:else}
    {#if seedType === 'Sugar Beet'}
      <p class="warn-banner" role="alert">
        ⚠️ {tr('tools.plate.sugarBeet')}
      </p>
    {/if}
    <p class="count" aria-live="polite">
      {results.length}
      {tr('tools.plate.found', { count: results.length })}
      {results.length === 20 ? ' ' + tr('tools.plate.first20') : ''}
    </p>
    {#if results.length === 0}
      <p class="empty">{tr('tools.plate.none')}</p>
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
                <dt>{tr('tools.plate.dimsLabel')}</dt>
                <dd>{p.dimensions} <small>{tr('tools.plate.dimsNote')}</small></dd>
              </div>
              {#if p.shape}<div>
                  <dt>{tr('tools.plate.shape')}</dt>
                  <dd>
                    <span class="badge shape-{p.shape.toLowerCase()}"
                      >{p.shape === 'Round'
                        ? tr('tools.plate.round')
                        : p.shape === 'Flat'
                          ? tr('tools.plate.flat')
                          : p.shape}</span
                    >
                  </dd>
                </div>{/if}
              <div>
                <dt>{tr('tools.plate.cells')}</dt>
                <dd>{p.cells}</dd>
              </div>
              <div>
                <dt>{tr('tools.plate.seriesLabel')}</dt>
                <dd>{p.series === 'B' ? tr('tools.plate.jd') : tr('tools.plate.ihc')}</dd>
              </div>
              <div>
                <dt>{tr('tools.plate.seedType')}</dt>
                <dd>{seedTypeLabel(p.seedType)}</dd>
              </div>
              {#if p.seedType === 'Corn' && p.gradeSize}<div>
                  <dt>{tr('tools.plate.grade')}</dt>
                  <dd><span class="badge grade">{p.gradeSize}</span></dd>
                </div>{/if}
              {#if p.seedType === 'Sorghum' && p.notes}<div>
                  <dt>{tr('tools.plate.seedsLb')}</dt>
                  <dd>{p.notes}</dd>
                </div>{/if}
              {#if p.seedType === 'Soybean' && p.notes}<div>
                  <dt>{tr('tools.plate.notes')}</dt>
                  <dd>{p.notes}</dd>
                </div>{/if}
              {#if 'delta' in p && p.delta !== undefined}<div>
                  <dt>{tr('tools.plate.score')}</dt>
                  <dd><strong>Δ = {p.delta}</strong></dd>
                </div>{/if}
            </dl>

            {#if data.canEdit && p.seedType !== 'Sugar Beet' && data.seedItems.length > 0}
              <form method="POST" action="?/saveToStock" class="save-form">
                <label class="save-target">
                  <span>{tr('tools.plate.saveTo')}</span>
                  <select name="stockId" bind:value={saveTargetId} required>
                    <option value="">{tr('tools.plate.chooseLot')}</option>
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
                {#if targetInRowSpacing !== null}<input
                    type="hidden"
                    name="inRowInches"
                    value={targetInRowSpacing}
                  />{/if}
                <input type="hidden" name="rowInches" value={targetRowSpacing ?? ''} />
                {#if plantsPerAcre !== null}<input
                    type="hidden"
                    name="plantsPerAcre"
                    value={plantsPerAcre}
                  />{/if}
                <button type="submit" class="primary save" disabled={!saveTargetId}
                  >{tr('tools.plate.saveBtn')}</button
                >
              </form>
            {:else if data.canEdit && data.seedItems.length === 0}
              <p class="empty save-empty">
                {tr('tools.plate.noSeed1')} <a href="/inventory/seed/add">/inventory</a>
                {tr('tools.plate.noSeed2')}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<footer class="foot">{tr('tools.plate.source')}</footer>

<style>
  .head .back {
    color: var(--color-forest-deep);
    text-decoration: none;
    font-weight: 600;
    display: inline-block;
    margin-bottom: 0.5rem;
  }
  .head h1 {
    margin: 0 0 0.25rem;
  }
  .subtitle {
    color: var(--color-ink-muted);
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
    color: var(--color-forest-deep);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  fieldset {
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin: 0 0 0.75rem;
  }
  legend {
    font-size: 0.8rem;
    color: var(--color-forest-deep);
    font-weight: 700;
    text-transform: uppercase;
    padding: 0 0.25rem;
  }
  legend .opt {
    color: var(--color-ink-soft);
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
    color: var(--color-ink);
  }
  select,
  input[type='number'],
  .row2 :global(.unit-input > input),
  input[type='range'] {
    padding: 0.6rem;
    border: 2px solid var(--color-divider);
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
    border: 1px solid var(--color-divider);
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
    color: var(--color-ink);
    border-right: 1px solid var(--color-divider);
  }
  .unit-btn:last-child {
    border-right: none;
  }
  .unit-btn.active {
    background: var(--color-forest-deep);
    color: white;
    font-weight: 600;
  }
  .hint {
    color: var(--color-ink-muted);
    font-size: 0.85rem;
    margin: 0 0 0.5rem;
  }
  .help {
    border: 1px solid var(--color-forest-deep);
    background: white;
    color: var(--color-forest-deep);
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    font-weight: 700;
    cursor: help;
    margin-left: 0.25rem;
    line-height: 1;
  }
  .primary {
    background: var(--color-forest-deep);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .primary:disabled {
    background: var(--color-ink-muted);
    cursor: not-allowed;
  }
  .secondary {
    background: white;
    color: var(--color-forest-deep);
    border: 2px solid var(--color-forest-deep);
    border-radius: 6px;
    padding: 0.5rem 1rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 40px;
  }
  .secondary:disabled {
    color: var(--color-ink-muted);
    border-color: var(--color-ink-muted);
    cursor: not-allowed;
  }
  .rec-inline {
    font-weight: 400;
    font-size: 0.75rem;
    color: var(--color-ink-muted);
    text-transform: none;
    letter-spacing: 0;
    margin-left: 0.4rem;
  }
  .density-disclosure {
    margin-top: 0.5rem;
    border-top: 1px dashed var(--color-divider);
    padding-top: 0.5rem;
  }
  .density-disclosure summary {
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--color-forest-deep);
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
    background: var(--color-cream);
    border-left: 3px solid var(--color-forest-deep);
    font-size: 0.9rem;
  }
  .rec-line.rec-low {
    border-left-color: #b35900;
  }
  .rec-line.rec-mid {
    border-left-color: #6b7280;
  }
  .rec-line.rec-high {
    border-left-color: var(--color-forest-deep);
  }
  .rec-line strong {
    display: block;
    color: var(--color-forest-deep);
    margin-bottom: 0.1rem;
  }
  .rec-line span {
    display: block;
    color: var(--color-ink-muted);
    font-size: 0.85rem;
  }
  .link-btn {
    background: none;
    border: none;
    color: var(--color-forest-deep);
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
    color: var(--color-ink);
    font-size: 0.9rem;
    margin: 0 0 0.75rem;
  }
  .empty {
    color: var(--color-ink-muted);
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
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-left: 4px solid var(--color-forest-deep);
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
    color: var(--color-forest-deep);
  }
  .color-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: white;
    border: 1px solid var(--color-divider);
    border-radius: 999px;
    padding: 0.15rem 0.5rem 0.15rem 0.15rem;
    font-size: 0.8rem;
    color: var(--color-ink);
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
    color: var(--color-ink-muted);
  }
  .plate-card dd {
    margin: 0;
  }
  .plate-card dd small {
    color: var(--color-ink-muted);
  }
  .badge {
    display: inline-block;
    background: #e7f1ea;
    color: var(--color-forest-deep);
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
    color: var(--color-ink-muted);
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
    color: var(--color-ink-soft);
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
      border: 1px solid var(--color-divider);
    }
    .cards {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
