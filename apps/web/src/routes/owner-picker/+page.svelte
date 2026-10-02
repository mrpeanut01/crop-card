<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  let { data }: { data: PageData } = $props();
  const tr = $derived(createT(page.data?.locale));
  function roleLabel(role: string): string {
    if (role === 'owner') return tr('entry.role.owner');
    if (role === 'helper') return tr('entry.role.helper');
    if (role === 'inspector') return tr('entry.role.inspector');
    return role;
  }
</script>

<svelte:head>
  <title>{tr('entry.picker.title')}</title>
</svelte:head>

<div class="picker">
  <h1>{tr('entry.picker.h1')}</h1>
  <p class="hint">
    {tr('entry.picker.hint')}
  </p>

  <form method="POST" action="?/pick" use:enhance>
    <ul class="choices">
      {#each data.choices as choice (choice.ownerId)}
        <li>
          <button class="choice" type="submit" name="ownerId" value={choice.ownerId}>
            <span class="name">{choice.name}</span>
            <span class="role">{roleLabel(choice.roleWithinOwner)}</span>
          </button>
        </li>
      {/each}
    </ul>
  </form>
</div>

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
    color: var(--color-ink-muted);
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
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    font: inherit;
    color: inherit;
    cursor: pointer;
    min-height: 56px;
  }
  .choice:hover {
    border-color: var(--color-forest-deep);
  }
  .name {
    font-weight: 600;
    color: var(--color-ink);
  }
  .role {
    color: var(--color-ink-muted);
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
