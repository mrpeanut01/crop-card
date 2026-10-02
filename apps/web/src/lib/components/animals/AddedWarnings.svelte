<script lang="ts">
  import './animalForms.css';
  import { addedHref, type AddedAnimals } from '$lib/animals/display';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    created: AddedAnimals;
  }

  const { created }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
</script>

<section class="af-note added-warnings" role="status">
  <p>{tr('animals.added.saved', { label: created.label })}</p>
  <ul>
    {#each created.warnings as w (w.animalId + w.message)}
      <li><a href="/animals/{w.animalId}">{w.message}</a></li>
    {/each}
  </ul>
  <a class="af-primary go" href={addedHref(created)}
    >{tr('animals.added.goTo', { label: created.label })}</a
  >
</section>

<style>
  .added-warnings p {
    margin: 0 0 var(--space-2);
  }
  .added-warnings ul {
    margin: 0 0 var(--space-3);
    padding-left: 1.2em;
  }
  .added-warnings li a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  .go {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
</style>
