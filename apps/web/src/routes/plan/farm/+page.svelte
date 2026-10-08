<script lang="ts">
  import { browser } from '$app/env';
  import FarmMapEditor from '$lib/components/farm/FarmMapEditor.svelte';
  import { createT } from '$lib/i18n';

  const { data } = $props();
  const tr = $derived(createT(data.locale));

  const hasFields = $derived(data.fields.length > 0);
  const hasBlocks = $derived(data.blocks.length > 0);
  const setUp = $derived(hasBlocks && data.blocks.some((b) => b.plantings.length > 0));
  const steps = $derived([
    { label: tr('plan.farm.stepAreas'), done: hasFields, current: !hasFields },
    { label: tr('plan.farm.stepBlocks'), done: hasBlocks, current: hasFields && !hasBlocks },
    { label: tr('plan.farm.stepPlan'), done: false, current: hasBlocks }
  ]);
</script>

<svelte:head
  ><title>{setUp ? tr('plan.farm.pageTitleSetUp') : tr('plan.farm.pageTitle')}</title></svelte:head
>

<div class="farm-setup">
  <header>
    <p class="kicker">{tr('plan.farm.kicker', { year: data.seasonYear })}</p>
    <h1 class="serif">{setUp ? tr('plan.farm.titleSetUp') : tr('plan.farm.title')}</h1>
    <p class="lede">{setUp ? tr('plan.farm.ledeSetUp') : tr('plan.farm.lede')}</p>
    {#if !setUp}
      <ol class="steps" aria-label={tr('plan.farm.progress')}>
        {#each steps as s, i (s.label)}
          <li
            class:done={s.done}
            class:current={s.current}
            aria-current={s.current ? 'step' : undefined}
          >
            <span class="dot">{s.done ? '✓' : i + 1}</span>
            {s.label}
          </li>
        {/each}
      </ol>
    {/if}
  </header>

  {#if browser}
    <FarmMapEditor
      blocks={data.blocks}
      fields={data.fields}
      shadeSources={data.shadeSources}
      mapFeatures={data.mapFeatures}
      ownerId={data.ownerId}
      snapshot={data.snapshot}
      housing={data.housing}
      grazing={data.grazing}
      petsLayout={data.petsLayout}
      coopSpecies={data.coopSpecies}
      farmAnimals={data.farmAnimals}
      canEdit
      isFirstRun={data.isFirstRun}
      initialCenter={data.center}
      initialMode={data.initialMode}
    />
  {:else}
    <section class="loading"><p>{tr('plan.farm.loadingMap')}</p></section>
  {/if}

  <footer class="continue-bar">
    {#if setUp}
      <p>{tr('plan.farm.mapBlocks', { count: data.blocks.length })}</p>
      <a class="continue" href="/plan">{tr('plan.farm.openPlan')}</a>
    {:else if hasBlocks}
      <p>{tr('plan.farm.blocksReady', { count: data.blocks.length })}</p>
      <a class="continue" href="/plan">{tr('plan.farm.continue')}</a>
    {:else}
      <p>
        {hasFields ? tr('plan.farm.addBlock') : tr('plan.farm.addArea')}
        <a class="skip" href="/plan?setup=skip">{tr('plan.farm.skip')}</a>
      </p>
      <span class="continue disabled" aria-disabled="true">{tr('plan.farm.continue')}</span>
    {/if}
  </footer>
</div>

<style>
  .farm-setup {
    max-width: 1100px;
    margin: 0 auto;
    padding: 16px 16px 96px;
  }
  .kicker {
    margin: 0;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  h1 {
    margin: 4px 0 6px;
    font-size: 1.9rem;
  }
  .lede {
    margin: 0 0 12px;
    color: var(--color-ink-soft);
    font-size: 14px;
    max-width: 70ch;
  }
  .steps {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    list-style: none;
    padding: 0;
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--color-ink-muted);
  }
  .steps li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .steps li.current {
    color: var(--color-ink);
    font-weight: 600;
  }
  .steps li.done {
    color: var(--color-forest);
  }
  .dot {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid currentColor;
    font-size: 11px;
  }
  .steps li.done .dot {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-cream);
  }
  .loading {
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 40px;
    text-align: center;
    color: var(--color-ink-muted);
  }
  .continue-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 16px;
    margin-top: 16px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    box-shadow: 0 -4px 12px rgb(0 0 0 / 6%);
    z-index: 1001;
  }
  @media (max-width: 768px) {
    .continue-bar {
      bottom: calc(72px + env(safe-area-inset-bottom, 0));
    }
  }
  .continue-bar p {
    margin: 0;
    font-size: 13.5px;
    color: var(--color-ink-soft);
  }
  .skip {
    display: inline-block;
    margin-left: 6px;
    padding: 12px 0;
  }
  .continue {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 18px;
    border-radius: 8px;
    background: var(--color-forest-deep);
    color: var(--color-paper);
    font-weight: 600;
    text-decoration: none;
  }
  .continue.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
