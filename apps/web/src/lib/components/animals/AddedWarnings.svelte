<script lang="ts">
  import './animalForms.css';
  import { addedHref, type AddedAnimals } from '$lib/animals/display';

  interface Props {
    created: AddedAnimals;
  }

  const { created }: Props = $props();
</script>

<section class="af-note added-warnings" role="status">
  <p>Saved {created.label}.</p>
  <ul>
    {#each created.warnings as w (w.animalId + w.message)}
      <li><a href="/animals/{w.animalId}">{w.message}</a></li>
    {/each}
  </ul>
  <a class="af-primary go" href={addedHref(created)}>Go to {created.label}</a>
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
