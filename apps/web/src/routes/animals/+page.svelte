<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import '$lib/components/animals/animalForms.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import AnimalRow from '$lib/components/animals/AnimalRow.svelte';
  import SetupSheet from '$lib/components/setup/SetupSheet.svelte';
  import SetupAnimal from '$lib/components/setup/SetupAnimal.svelte';
  import AddedWarnings from '$lib/components/animals/AddedWarnings.svelte';
  import {
    STATUS_LABEL,
    ageText,
    animalLabel,
    addedHref,
    countText,
    type AddedAnimals
  } from '$lib/animals/display';
  import { individualsFirst, showsFarmFields, suggestedSpecies } from '$lib/animals/profile';
  import { DEFAULT_PREFS, formatInstant } from '$lib/prefs';

  const { data } = $props();

  const prefs = $derived(data.prefs ?? DEFAULT_PREFS);
  const layout = $derived(data.profile.layout);
  const speciesById = $derived(new Map(data.species.map((s) => [s.id, s])));
  const areaName = $derived(new Map(data.areas.map((a) => [a.id, a.name])));
  const groupName = $derived(new Map(data.groups.map((g) => [g.id, g.name])));
  const individuals = $derived(data.animals.filter((a) => !a.groupId || data.showArchived));
  const hereCount = $derived(
    data.groups.reduce((n, g) => n + g.total, 0) + data.animals.filter((a) => !a.groupId).length
  );
  const empty = $derived(
    !data.showArchived &&
      data.groups.length === 0 &&
      data.animals.length === 0 &&
      data.gone.length === 0
  );
  const groupsFirst = $derived(!individualsFirst(layout));

  let setupOpen = $state(false);
  let created = $state<AddedAnimals | null>(null);

  function added(result: AddedAnimals) {
    setupOpen = false;
    if (result.warnings.length > 0) {
      created = result;
      void invalidateAll();
      return;
    }
    void goto(addedHref(result));
  }
</script>

<svelte:head>
  <title>{data.profile.title} · CropCard</title>
</svelte:head>

<div class="animals-page">
  <header class="page-header">
    <div class="titles">
      <Kicker>{data.showArchived ? 'Archived' : layout === 'pets' ? 'Household' : 'Farm'}</Kicker>
      <h1 class="serif">{data.profile.title}</h1>
      {#if !empty && !data.showArchived}
        <p class="stat-line">
          <strong>{hereCount}</strong>
          {hereCount === 1 ? 'animal' : 'animals'} here
        </p>
      {/if}
    </div>
    {#if data.canEdit && !empty}
      <a class="af-primary add" href="/animals/add">Add</a>
    {/if}
  </header>

  {#if created}
    <AddedWarnings {created} />
  {/if}

  {#if empty}
    <section class="empty">
      <p>Nothing here yet. Add each animal you keep, or a whole flock with a count.</p>
      {#if data.canEdit}
        <div class="empty-actions">
          <button type="button" class="af-primary" onclick={() => (setupOpen = true)}>
            Add your first animal
          </button>
          <a class="af-ghost link-button" href="/animals/add">Open the full form</a>
        </div>
      {:else}
        <p class="af-note" role="note">Ask the owner to add the animals.</p>
      {/if}
    </section>
  {:else}
    {#snippet groupList()}
      {#if data.groups.length > 0}
        <section aria-labelledby="groups-h">
          <h2 id="groups-h" class="section-title">
            {layout === 'pets' ? 'Flocks and groups' : 'Herds and flocks'}
          </h2>
          <ul class="rows">
            {#each data.groups as g (g.id)}
              {@const sp = speciesById.get(g.speciesId)}
              <li>
                <AnimalRow
                  href="/animals/groups/{g.id}"
                  icon={sp?.icon}
                  title={g.name}
                  meta={[
                    countText(g.total, sp),
                    g.housingFieldId ? areaName.get(g.housingFieldId) : null
                  ]}
                  foodProducing={g.effectiveFoodProducing}
                  status={g.status === 'archived' ? 'Archived' : null}
                />
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/snippet}

    {#snippet individualList()}
      {#if individuals.length > 0}
        <section aria-labelledby="individuals-h">
          <h2 id="individuals-h" class="section-title">
            {layout === 'pets' ? 'Your animals' : 'Individual animals'}
          </h2>
          <ul class="rows">
            {#each individuals as a (a.id)}
              {@const sp = speciesById.get(a.speciesId)}
              {@const farm = showsFarmFields(layout, a.purpose)}
              <li>
                <AnimalRow
                  href="/animals/{a.id}"
                  icon={sp?.icon}
                  title={farm || !a.name ? animalLabel(a) : a.name}
                  meta={[
                    sp?.displayName,
                    ageText(a.birthDate, a.birthDateEstimated),
                    a.groupId
                      ? groupName.get(a.groupId)
                      : a.housingFieldId
                        ? areaName.get(a.housingFieldId)
                        : null,
                    farm && a.tag && a.name ? `Tag ${a.tag}` : null
                  ]}
                  foodProducing={a.foodProducing}
                  status={a.status === 'archived' ? 'Archived' : null}
                />
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/snippet}

    {#if groupsFirst}
      {@render groupList()}
      {@render individualList()}
    {:else}
      {@render individualList()}
      {@render groupList()}
    {/if}

    {#if data.gone.length > 0}
      <details class="gone">
        <summary>No longer here ({data.gone.length})</summary>
        <ul class="rows">
          {#each data.gone as a (a.id)}
            {@const sp = speciesById.get(a.speciesId)}
            <li>
              <AnimalRow
                href="/animals/{a.id}"
                icon={sp?.icon}
                title={animalLabel(a)}
                meta={[
                  sp?.displayName,
                  a.statusDate ? formatInstant(a.statusDate, prefs, 'date') : null
                ]}
                foodProducing={a.foodProducing}
                status={STATUS_LABEL[a.status]}
              />
            </li>
          {/each}
        </ul>
      </details>
    {/if}

    {#if data.showArchived}
      {#if data.groups.length === 0 && data.animals.length === 0}
        <p class="af-help">Nothing is archived.</p>
      {/if}
      <a class="af-ghost link-button" href="/animals">Back to the animals here</a>
    {:else if data.archivedCount > 0}
      <a class="af-ghost link-button" href="/animals?archived=1">
        Show archived ({data.archivedCount})
      </a>
    {/if}
  {/if}
</div>

<SetupSheet
  open={setupOpen}
  title="Add an animal"
  kicker={data.profile.title}
  onClose={() => (setupOpen = false)}
  onDone={added}
>
  {#snippet children(done: (value: AddedAnimals) => void)}
    <SetupAnimal
      species={data.species}
      areas={data.housingAreas}
      {layout}
      canEdit={data.canEdit}
      initialSpecies={suggestedSpecies(data.profile.choices)}
      onDone={done}
    />
  {/snippet}
</SetupSheet>

<style>
  .animals-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .titles {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  h1 {
    margin: 0;
  }
  .stat-line {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .add,
  .link-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    box-sizing: border-box;
  }
  .link-button {
    align-self: flex-start;
  }
  .section-title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-card-title);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .empty {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px dashed var(--color-divider);
    border-radius: var(--radius-card);
  }
  .empty p {
    margin: 0;
  }
  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .gone summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    cursor: pointer;
    font-weight: 600;
  }
  .gone .rows {
    margin-top: var(--space-2);
  }
</style>
