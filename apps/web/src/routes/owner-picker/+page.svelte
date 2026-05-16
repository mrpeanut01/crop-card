<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Choose farm — CropCard</title>
</svelte:head>

<main class="picker">
  <h1>Choose a farm</h1>
  <p class="hint">
    You're assigned to multiple farms. Pick the one you want to work on; you can switch later from
    the top nav.
  </p>

  <form method="POST" action="?/pick" use:enhance>
    <ul class="choices">
      {#each data.choices as choice}
        <li>
          <button class="choice" type="submit" name="ownerId" value={choice.ownerId}>
            <span class="name">{choice.name}</span>
            <span class="role">{choice.roleWithinOwner}</span>
          </button>
        </li>
      {/each}
    </ul>
  </form>
</main>

<style>
  .picker {
    max-width: 32rem;
    margin: 4rem auto;
    padding: 1.5rem;
  }
  h1 {
    margin-top: 0;
  }
  .hint {
    color: var(--fg-muted, #555);
    margin-bottom: 1.5rem;
  }
  .choices {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.75rem;
  }
  .choice {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    background: var(--bg-card, white);
    border: 1px solid var(--divider, #ccc);
    border-radius: 0.5rem;
    font: inherit;
    color: inherit;
    cursor: pointer;
    min-height: 56px;
  }
  .choice:hover {
    border-color: var(--accent, #1f5e3a);
  }
  .name {
    font-weight: 600;
  }
  .role {
    color: var(--fg-muted, #555);
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
