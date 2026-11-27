<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { Carrot, Flower2, Grape, Leaf, Rows3, SquareStack, TreeDeciduous } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import AiLimitNudge from '$lib/components/billing/AiLimitNudge.svelte';
  import AiUsageChip from '$lib/components/billing/AiUsageChip.svelte';
  import SetupFarmClimate from '$lib/components/setup/SetupFarmClimate.svelte';
  import SiteFinderMap from '$lib/components/siteFinder/SiteFinderMap.svelte';
  import SpotCard from '$lib/components/siteFinder/SpotCard.svelte';
  import { createT, type MessageKey } from '$lib/i18n';
  import { fromDisplay, toDisplay, unitLabel, unitWord } from '$lib/prefs';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import type { SiteFinderResponse, SeenItem } from '$lib/siteFinder/apiSchemas';
  import { defaultHeightFt } from '$lib/siteFinder/sun';
  import {
    boxAround,
    boxCenter,
    boxSizeM,
    FT_TO_M,
    localFrame,
    toLonLat
  } from '$lib/siteFinder/geometry';
  import {
    GOALS,
    MIN_BOX_M,
    PLANTING_GOALS,
    type LonLat,
    type PlantingGoal,
    type SearchBox
  } from '$lib/siteFinder/types';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();
  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale ?? null);
  const prefs = $derived(currentPrefs());
  const k = (key: string) => `sitefinder.${key}` as MessageKey;

  const ICONS: Record<PlantingGoal, typeof Leaf> = {
    'vegetable-garden': Carrot,
    'herb-garden': Leaf,
    'flower-garden': Flower2,
    'raised-beds': SquareStack,
    'fruit-trees': TreeDeciduous,
    'berry-patch': Grape,
    'row-crop-field': Rows3
  };

  // Starting box sizes in metres. App defaults the owner changes with the
  // Smaller and Larger buttons.
  const START_BOX_SHARE = 0.5;
  const BOX_STEP = 1.25;

  let ready = $state(false);
  let goal = $state<PlantingGoal | null>(null);
  let width = $state(0);
  let length = $state(0);
  let box = $state<SearchBox | null>(null);
  let useAerial = $state(false);
  let allowOverlap = $state<string[]>([]);
  let busy = $state(false);
  let failure = $state<string | null>(null);
  let result = $state<SiteFinderResponse | null>(null);
  let resultGoal = $state<PlantingGoal | null>(null);
  let dismissed = $state<string[]>([]);
  let created = $state<Record<string, { id: string; name: string }>>({});
  let createBusy = $state<string | null>(null);
  let createError = $state<Record<string, string>>({});
  let usageKey = $state(0);
  let adding = $state<string | null>(null);
  let addHeight = $state(0);
  let addBusy = $state(false);
  let addError = $state<string | null>(null);
  let added = $state<string[]>([]);

  onMount(() => {
    ready = true;
  });

  const unit = $derived(unitWord(unitLabel('distance', prefs), locale));
  const round = (n: number) => Math.round(n * 10) / 10;
  const footprintFt = $derived({
    width: fromDisplay(Number(width) || 0, 'distance', prefs),
    length: fromDisplay(Number(length) || 0, 'distance', prefs)
  });
  const boxM = $derived(box ? Math.round(boxSizeM(box).widthM) : 0);
  const maxBoxM = $derived(goal ? GOALS[goal].maxBoxM : 0);
  const minBoxM = $derived(
    Math.max(MIN_BOX_M, Math.max(footprintFt.width, footprintFt.length) * FT_TO_M * 1.2)
  );
  const boxText = $derived(`${Math.round(toDisplay(boxM / FT_TO_M, 'distance', prefs))} ${unit}`);

  function setBox(center: LonLat, sizeM: number) {
    const size = Math.max(minBoxM, Math.min(maxBoxM || sizeM, sizeM));
    box = boxAround(center, size);
  }

  function pickGoal(g: PlantingGoal) {
    goal = g;
    const fp = GOALS[g].defaultFootprint;
    width = round(toDisplay(fp.widthFt, 'distance', prefs));
    length = round(toDisplay(fp.lengthFt, 'distance', prefs));
    if (data.center) {
      const center: LonLat = box ? boxCenter(box) : [data.center.lon, data.center.lat];
      untrack(() => setBox(center, GOALS[g].maxBoxM * START_BOX_SHARE));
    }
  }

  function resize(factor: number) {
    if (box) setBox(boxCenter(box), boxSizeM(box).widthM * factor);
  }

  const validSize = $derived(
    footprintFt.width >= 2 &&
      footprintFt.length >= 2 &&
      footprintFt.width <= 1000 &&
      footprintFt.length <= 1000
  );

  async function run() {
    if (!goal || !box || !validSize || busy) return;
    busy = true;
    failure = null;
    try {
      const res = await fetch('/api/site-finder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal,
          box,
          footprintFt,
          useAerial: useAerial && !!data.ai?.available,
          allowOverlapAreaIds: allowOverlap
        })
      });
      const body = (await res.json().catch(() => null)) as
        (SiteFinderResponse & { error?: string }) | null;
      if (!res.ok || !body) {
        failure = body?.error ?? tr('sitefinder.err.failed');
        return;
      }
      result = body;
      resultGoal = goal;
      dismissed = [];
      created = {};
      createError = {};
      added = [];
      adding = null;
    } catch {
      failure = tr('sitefinder.err.offline');
    } finally {
      busy = false;
      usageKey += 1;
    }
  }

  const shown = $derived((result?.candidates ?? []).filter((c) => !dismissed.includes(c.id)));

  async function createArea(id: string, name: string) {
    const cand = result?.candidates.find((c) => c.id === id);
    if (!cand || !resultGoal) return;
    createBusy = id;
    createError = { ...createError, [id]: '' };
    try {
      const res = await fetch('/api/fields', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          kind: GOALS[resultGoal].areaKind,
          geometryGeojson: { type: 'Polygon', coordinates: [cand.polygon] }
        })
      });
      const body = (await res.json().catch(() => null)) as {
        field?: { id: string; name: string };
        error?: string;
        message?: string;
      } | null;
      if (!res.ok || !body?.field) {
        createError = {
          ...createError,
          [id]: body?.error ?? body?.message ?? tr('sitefinder.err.createFailed')
        };
        return;
      }
      created = { ...created, [id]: { id: body.field.id, name: body.field.name } };
    } catch {
      createError = { ...createError, [id]: tr('sitefinder.err.offline') };
    } finally {
      createBusy = null;
    }
  }

  const ADDABLE: Partial<Record<SeenItem['kind'], 'tree-single' | 'tree-row' | 'building'>> = {
    tree: 'tree-single',
    'tree-line': 'tree-row',
    building: 'building'
  };

  function startAdd(item: SeenItem) {
    adding = item.id;
    addError = null;
    const kind = item.kind === 'building' ? 'building' : 'tree';
    addHeight = Math.round(toDisplay(defaultHeightFt(kind), 'distance', prefs));
  }

  function circleRing(center: LonLat, radiusM: number): LonLat[] {
    const f = localFrame(center);
    const ring: LonLat[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      ring.push(toLonLat(f, [radiusM * Math.cos(a), radiusM * Math.sin(a)]));
    }
    return [...ring, ring[0]];
  }

  async function addToMap(item: SeenItem) {
    const kind = ADDABLE[item.kind];
    const obstacle = result?.obstacles.find((o) => o.id === item.obstacleId);
    const heightFt = fromDisplay(Number(addHeight) || 0, 'distance', prefs);
    if (!kind || !obstacle || !(heightFt > 0) || heightFt > 200) {
      addError = tr('sitefinder.seen.heightNeeded');
      return;
    }
    addBusy = true;
    addError = null;
    const geometry =
      obstacle.shape.type === 'line'
        ? { type: 'LineString', coordinates: obstacle.shape.points }
        : obstacle.shape.type === 'circle'
          ? {
              type: 'Polygon',
              coordinates: [circleRing(obstacle.shape.center, obstacle.shape.radiusM)]
            }
          : { type: 'Polygon', coordinates: [obstacle.shape.ring] };
    try {
      const res = await fetch('/api/shade-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: tr(k(`seen.kind.${item.kind}`)),
          kind,
          geometryGeojson: JSON.stringify(geometry),
          heightFt
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        addError = body?.error ?? tr('sitefinder.err.createFailed');
        return;
      }
      added = [...added, item.id];
      adding = null;
    } catch {
      addError = tr('sitefinder.err.offline');
    } finally {
      addBusy = false;
    }
  }

  const notChecked = $derived.by(() => {
    if (!result) return [];
    const keys: string[] = [];
    if (!result.shadeChecked) keys.push('unchecked.shade');
    keys.push('unchecked.outside');
    if (result.terrain.status === 'unavailable') keys.push('unchecked.terrainUnavailable');
    else if (result.terrain.status === 'no-data') keys.push('unchecked.terrainNoData');
    if (!result.hasWaterPoint) keys.push('unchecked.water');
    if (result.soil.status === 'unavailable') keys.push('unchecked.soilUnavailable');
    else if (result.soil.status === 'no-data' || result.soil.survey.notSoil) {
      keys.push('unchecked.soilNoData');
    }
    if (result.imagery.used) keys.push('unchecked.photoAge');
    keys.push('unchecked.underground', 'unchecked.rules', 'unchecked.walk');
    return keys;
  });
</script>

<svelte:head><title>{tr('sitefinder.docTitle')} · CropCard</title></svelte:head>

<div class="finder" data-testid="site-finder" data-ready={ready}>
  <header>
    <Kicker>{tr('sitefinder.kicker')}</Kicker>
    <h1 class="serif">{tr('sitefinder.title')}</h1>
    <p class="lede">{tr('sitefinder.lede')}</p>
  </header>

  {#if !data.canEdit}
    <section class="panel" data-testid="site-finder-readonly">
      <p>{tr('sitefinder.readonly.body')}</p>
      <p class="ask" data-testid="site-finder-ask-owner">{tr('sitefinder.readonly.ask')}</p>
      <a class="ghost" href="/plan">{tr('sitefinder.backToPlan')}</a>
    </section>
  {:else}
    <section class="step" aria-labelledby="sf-goal">
      <h2 id="sf-goal" class="serif">{tr('sitefinder.step.goal')}</h2>
      <ul class="goals">
        {#each PLANTING_GOALS as g (g)}
          {@const Icon = ICONS[g]}
          <li>
            <button
              type="button"
              class="goal"
              class:on={goal === g}
              aria-pressed={goal === g}
              disabled={!ready}
              data-testid={`goal-${g}`}
              onclick={() => pickGoal(g)}
            >
              <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
              <span class="goal-title">{tr(k(`goal.${g}.title`))}</span>
              <span class="goal-hint">{tr(k(`goal.${g}.hint`))}</span>
            </button>
          </li>
        {/each}
      </ul>
      {#if goal}
        <div class="size">
          <p class="size-lede">{tr('sitefinder.size.lede')}</p>
          <div class="size-fields">
            <label>
              <span>{tr('sitefinder.size.width', { unit })}</span>
              <input
                type="number"
                inputmode="decimal"
                min="1"
                step="any"
                bind:value={width}
                data-testid="size-width"
              />
            </label>
            <label>
              <span>{tr('sitefinder.size.length', { unit })}</span>
              <input
                type="number"
                inputmode="decimal"
                min="1"
                step="any"
                bind:value={length}
                data-testid="size-length"
              />
            </label>
          </div>
          {#if !validSize}<p class="error" role="alert">{tr('sitefinder.size.invalid')}</p>{/if}
        </div>
      {/if}
    </section>

    {#if goal}
      <section class="step" aria-labelledby="sf-where">
        <h2 id="sf-where" class="serif">{tr('sitefinder.step.where')}</h2>
        {#if !data.center || !box}
          <p class="note" data-testid="site-finder-need-location">
            {tr('sitefinder.where.needLocation')}
          </p>
          <SetupFarmClimate latLon={null} onDone={() => void invalidateAll()} />
        {:else}
          <p class="note">{tr('sitefinder.where.lede')}</p>
          <SiteFinderMap
            {box}
            areas={data.areas}
            obstacles={data.obstacles}
            water={data.water}
            candidates={shown}
            seen={result?.seen ?? []}
            onMove={(c) => box && setBox(c, boxSizeM(box).widthM)}
          />
          <div class="box-tools">
            <button
              type="button"
              class="ghost"
              disabled={boxM <= minBoxM + 0.5}
              onclick={() => resize(1 / BOX_STEP)}
              data-testid="box-smaller">{tr('sitefinder.where.smaller')}</button
            >
            <button
              type="button"
              class="ghost"
              disabled={boxM >= maxBoxM - 0.5}
              onclick={() => resize(BOX_STEP)}
              data-testid="box-larger">{tr('sitefinder.where.larger')}</button
            >
            <span class="box-size" data-testid="box-size"
              >{tr('sitefinder.where.boxSize', { size: boxText })}</span
            >
          </div>
          <p class="note small">{tr('sitefinder.where.tilesNote')}</p>
        {/if}
      </section>

      {#if data.center && box}
        <section class="step" aria-labelledby="sf-options">
          <h2 id="sf-options" class="serif">{tr('sitefinder.step.options')}</h2>
          {#if data.overlapChoices.length > 0}
            <fieldset class="overlap">
              <legend>{tr('sitefinder.options.overlapLegend')}</legend>
              {#each data.overlapChoices as a (a.id)}
                <label class="check">
                  <input type="checkbox" value={a.id} bind:group={allowOverlap} />
                  <span>{tr('sitefinder.options.overlap', { name: a.name })}</span>
                </label>
              {/each}
            </fieldset>
          {/if}
          <label class="check" class:off={!data.ai?.available}>
            <input
              type="checkbox"
              bind:checked={useAerial}
              disabled={!data.ai?.available}
              data-testid="use-aerial"
            />
            <span>{tr('sitefinder.options.aerial')}</span>
          </label>
          <p class="note small">{tr('sitefinder.options.aerialNote')}</p>
          {#if data.ai && !data.ai.available}
            <p class="note small" data-testid="aerial-unavailable">
              {tr('sitefinder.options.aerialOff', { reason: data.ai.reason ?? '' })}
              {tr('sitefinder.options.worksWithout')}
            </p>
          {:else}
            <AiUsageChip refreshKey={usageKey} />
          {/if}
          <div class="actions">
            <button
              type="button"
              class="primary"
              disabled={busy || !validSize}
              onclick={run}
              data-testid="find-spots"
            >
              {busy ? tr('sitefinder.run.busy') : tr('sitefinder.run.go')}
            </button>
          </div>
          {#if failure}<p class="error" role="alert">{failure}</p>{/if}
        </section>
      {/if}
    {/if}

    {#if result}
      <section
        class="step results"
        aria-labelledby="sf-results"
        data-testid="site-finder-results"
        data-provenance={result.provenance}
      >
        <h2 id="sf-results" class="serif">{tr('sitefinder.step.results')}</h2>
        {#if result.message}
          <p class="banner" data-testid="site-finder-fallback">{result.message}</p>
          <AiLimitNudge limit={result.aiLimit} isOwner={data.canEdit} />
        {/if}
        <p class="note">
          <Provenance
            source={result.provenance}
            label={result.provenance === 'fallback' ? tr('sitefinder.prov.estimate') : undefined}
          />
          {result.provenance === 'ai'
            ? tr('sitefinder.results.fromAi')
            : tr('sitefinder.results.fromEngine')}
          {tr('sitefinder.results.roughGuide')}
        </p>
        {#if result.tooBig}
          <p class="banner" data-testid="site-finder-too-big">{tr('sitefinder.results.tooBig')}</p>
        {:else if result.candidates.length === 0}
          <p class="banner" data-testid="site-finder-none">{tr('sitefinder.results.none')}</p>
        {:else if shown.length === 0}
          <p class="note">{tr('sitefinder.results.allDismissed')}</p>
        {/if}
        <div class="spots">
          {#each shown as c (c.id)}
            {@const rank = result.candidates.findIndex((x) => x.id === c.id)}
            <SpotCard
              candidate={c}
              {rank}
              soil={result.soilBySpot[c.id] ?? result.soil}
              areaKind={GOALS[resultGoal ?? 'vegetable-garden'].areaKind}
              defaultName={tr(k(`goal.${resultGoal ?? 'vegetable-garden'}.areaName`))}
              created={created[c.id] ?? null}
              busy={createBusy === c.id}
              error={createError[c.id] || null}
              onCreate={(name) => createArea(c.id, name)}
              onDismiss={() => (dismissed = [...dismissed, c.id])}
            />
          {/each}
        </div>

        {#if result.aiSpots.some((s) => !s.candidateId)}
          <ul class="also" data-testid="ai-also">
            {#each result.aiSpots.filter((s) => !s.candidateId) as s, i (i)}
              <li>
                <Provenance source="ai" />
                {tr('sitefinder.also.lead')}
                <span lang="en">{s.reason}</span>
                {tr(k(`also.${s.engineReason ?? 'lower-score'}`))}
              </li>
            {/each}
          </ul>
        {/if}

        {#if result.seen.length > 0}
          <section class="seen" aria-labelledby="sf-seen" data-testid="site-finder-seen">
            <h3 id="sf-seen" class="serif">{tr('sitefinder.seen.title')}</h3>
            <p class="note small">{tr('sitefinder.seen.lede')}</p>
            <ul>
              {#each result.seen as item (item.id)}
                <li data-testid="seen-item" data-kind={item.kind}>
                  <div class="seen-line">
                    <strong>{tr(k(`seen.kind.${item.kind}`))}</strong>
                    <Provenance source="ai" />
                    {#if item.note}<span class="seen-note" lang="en">{item.note}</span>{/if}
                  </div>
                  {#if item.onMap}
                    <span class="note small">{tr('sitefinder.seen.onMap')}</span>
                  {:else if added.includes(item.id)}
                    <span class="note small" role="status" data-testid="seen-added"
                      >{tr('sitefinder.seen.added')}</span
                    >
                  {:else if ADDABLE[item.kind] && item.obstacleId}
                    {#if adding === item.id}
                      <form
                        class="add-form"
                        onsubmit={(e) => {
                          e.preventDefault();
                          void addToMap(item);
                        }}
                      >
                        <label>
                          <span>{tr('sitefinder.seen.height', { unit })}</span>
                          <input
                            type="number"
                            inputmode="decimal"
                            min="1"
                            step="any"
                            bind:value={addHeight}
                            data-testid="seen-height"
                          />
                        </label>
                        <p class="note small">{tr('sitefinder.seen.heightHint')}</p>
                        {#if addError}<p class="error" role="alert">{addError}</p>{/if}
                        <div class="actions">
                          <button
                            type="submit"
                            class="primary"
                            disabled={addBusy}
                            data-testid="seen-save">{tr('sitefinder.seen.save')}</button
                          >
                          <button type="button" class="ghost" onclick={() => (adding = null)}
                            >{tr('sitefinder.spot.cancel')}</button
                          >
                        </div>
                      </form>
                    {:else}
                      <button
                        type="button"
                        class="ghost"
                        onclick={() => startAdd(item)}
                        data-testid="seen-add">{tr('sitefinder.seen.add')}</button
                      >
                    {/if}
                  {/if}
                </li>
              {/each}
            </ul>
            {#if result.aiCaveats}
              <p class="note small">
                <Provenance source="ai" />
                <span lang="en">{result.aiCaveats}</span>
              </p>
            {/if}
          </section>
        {/if}

        <section
          class="unchecked"
          aria-labelledby="sf-unchecked"
          data-testid="site-finder-unchecked"
        >
          <h3 id="sf-unchecked" class="serif">{tr('sitefinder.unchecked.title')}</h3>
          <ul>
            {#each notChecked as key (key)}
              <li>{tr(k(key))}</li>
            {/each}
          </ul>
          {#if result.imagery.used}
            <p class="note small">{tr('sitefinder.results.photoSource')}</p>
          {/if}
          {#if result.terrain.status === 'ok'}
            <p class="note small" data-testid="site-finder-elevation-source">
              {tr('sitefinder.results.elevationSource')}
            </p>
          {/if}
        </section>
      </section>
    {/if}
  {/if}
</div>

<style>
  .finder {
    max-width: 960px;
    margin: 0 auto;
    padding: var(--space-3);
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  h1 {
    margin: var(--space-1) 0;
  }
  h2,
  h3 {
    margin: 0 0 var(--space-2);
  }
  .lede,
  .note,
  .ask {
    color: var(--color-ink-soft);
    margin: 0 0 var(--space-2);
  }
  .small {
    font-size: var(--text-sm, 0.9rem);
  }
  .step,
  .panel {
    min-width: 0;
  }
  .goals {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-2);
  }
  .goals li {
    display: flex;
  }
  .goal {
    width: 100%;
    min-height: 88px;
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    column-gap: var(--space-2);
    align-items: start;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 12px);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    cursor: pointer;
  }
  .goal.on {
    border-color: var(--color-forest);
    box-shadow: inset 0 0 0 2px var(--color-forest);
  }
  .goal-title {
    font-weight: 700;
  }
  .goal-hint {
    grid-column: 2;
    color: var(--color-ink-soft);
    font-size: var(--text-sm, 0.9rem);
  }
  .size {
    margin-top: var(--space-3);
  }
  .size-lede {
    margin: 0 0 var(--space-2);
    color: var(--color-ink-soft);
  }
  .size-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 12rem));
    gap: var(--space-2);
  }
  label {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  input[type='number'] {
    min-height: 48px;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-input);
    font: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  .box-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0;
  }
  .box-size {
    color: var(--color-ink-soft);
  }
  .check {
    display: flex;
    grid-template-columns: none;
    align-items: center;
    gap: var(--space-2);
    min-height: 48px;
  }
  .check input {
    width: 22px;
    height: 22px;
    flex: none;
  }
  .check.off {
    color: var(--color-ink-soft);
  }
  .overlap {
    border: 0;
    padding: 0;
    margin: 0 0 var(--space-2);
    min-width: 0;
  }
  .overlap legend {
    padding: 0;
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .primary,
  .ghost {
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-forest);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-paper, #fff);
  }
  .ghost {
    background: transparent;
    color: var(--color-forest);
  }
  .primary:disabled,
  .ghost:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .error {
    margin: var(--space-2) 0 0;
    color: var(--color-rust-deep, #8a2f1d);
  }
  .banner {
    margin: 0 0 var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-left: 4px solid var(--color-honey-deep, #6a4f00);
    background: var(--color-honey-tint, #fff4d6);
    border-radius: 6px;
  }
  .spots {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: var(--space-3);
    align-items: start;
  }
  .also,
  .seen ul,
  .unchecked ul {
    margin: 0;
    padding-left: 1.2em;
    display: grid;
    gap: var(--space-2);
  }
  .also {
    margin-top: var(--space-3);
    list-style: none;
    padding-left: 0;
  }
  .seen,
  .unchecked {
    margin-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
    padding-top: var(--space-3);
  }
  .seen ul {
    list-style: none;
    padding-left: 0;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .seen-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
  }
  .seen-note {
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .add-form {
    margin-top: var(--space-2);
    max-width: 22rem;
  }
</style>
