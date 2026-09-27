<script lang="ts">
  import AnimalAddForm from '$lib/components/animals/AnimalAddForm.svelte';
  import type { AddedAnimals, AreaOption, SpeciesOption } from '$lib/animals/display';
  import type { AnimalsLayout } from '$lib/animals/profile';

  interface Props {
    species: SpeciesOption[];
    areas: AreaOption[];
    layout: AnimalsLayout;
    canEdit: boolean;
    initialSpecies?: string | null;
    initialAreaId?: string | null;
    onDone: (result: AddedAnimals) => void;
  }

  const { species, areas, layout, canEdit, initialSpecies, initialAreaId, onDone }: Props =
    $props();
</script>

{#if canEdit}
  <p class="lede">Pick the kind of animal and give it a name. The rest can wait.</p>
{/if}
<AnimalAddForm
  {species}
  {areas}
  {layout}
  {canEdit}
  {initialSpecies}
  {initialAreaId}
  onCreated={onDone}
/>

<style>
  .lede {
    margin: 0 0 var(--space-3);
    color: var(--color-ink-soft);
  }
</style>
