<script lang="ts">
  import { goto } from '$app/navigation';
  import '$lib/components/animals/animalForms.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import AnimalAddForm from '$lib/components/animals/AnimalAddForm.svelte';
  import AddedWarnings from '$lib/components/animals/AddedWarnings.svelte';
  import { addedHref, type AddedAnimals } from '$lib/animals/display';
  import { pageTitle } from '$lib/components/animals/labels';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));

  const title = $derived(pageTitle(tr, data.profile.layout));
  let created = $state<AddedAnimals | null>(null);

  function onCreated(result: AddedAnimals) {
    if (result.warnings.length === 0) {
      void goto(addedHref(result));
      return;
    }
    created = result;
  }
</script>

<svelte:head>
  <title>{tr('animals.add.link')} · {title} · CropCard</title>
</svelte:head>

<div class="add-page">
  <nav class="crumbs" aria-label={tr('animals.breadcrumb')}>
    <a href="/animals">{title}</a>
    <span aria-hidden="true">›</span>
    <span>{tr('animals.add.link')}</span>
  </nav>
  <header>
    <Kicker>{title}</Kicker>
    <h1 class="serif">{tr('animals.add.heading')}</h1>
  </header>

  {#if created}
    <AddedWarnings {created} />
  {:else}
    <AnimalAddForm
      species={data.species}
      areas={data.areas}
      groups={data.groups}
      layout={data.profile.layout}
      full
      canEdit={data.canEdit}
      initialSpecies={data.initialSpecies}
      initialMode={data.initialMode}
      initialAreaId={data.initialAreaId}
      {onCreated}
    />
  {/if}
</div>

<style>
  .add-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 640px;
    min-width: 0;
  }
  .crumbs {
    display: flex;
    gap: var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-ink-muted);
  }
  .crumbs a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  h1 {
    margin: 0;
  }
</style>
