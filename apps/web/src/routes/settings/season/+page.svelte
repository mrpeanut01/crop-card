<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import SeasonSetupStep from '$lib/components/SeasonSetupStep.svelte';
  import SeasonSetupChip from '$lib/components/SeasonSetupChip.svelte';
  import type { SeasonSetup } from '$lib/season/setup';

  let { data }: { data: PageData } = $props();

  // Initial state from server-loaded data; subsequent updates flow via
  // handleSave from the SeasonSetupStep child component.
  let existing = $state<SeasonSetup | null>(untrack(() => data.existing));
  let editing = $state(untrack(() => !data.existing));
  let savedNotice = $state<string | null>(null);

  function handleSave(setup: SeasonSetup) {
    existing = setup;
    editing = false;
    savedNotice = `Saved for ${setup.year}.`;
    // Clear the notice after a few seconds so it doesn't linger.
    setTimeout(() => {
      savedNotice = null;
    }, 4000);
  }
</script>

<svelte:head>
  <title>Season setup — CropCard</title>
</svelte:head>

<main class="season-page">
  <header class="page-header">
    <a class="back-link" href="/settings">← Settings</a>
    <h1>Season setup</h1>
    <p class="hint">
      Your input philosophy for the {data.currentYear} planting year. Drives what products and tasks the
      Plan wizard suggests.
    </p>
  </header>

  {#if savedNotice}
    <p class="success" role="status">{savedNotice}</p>
  {/if}

  {#if editing}
    <SeasonSetupStep
      {existing}
      lastYearSetup={data.lastYearSetup}
      currentYear={data.currentYear}
      onSave={handleSave}
    />
    {#if existing}
      <p class="actions-row">
        <button type="button" class="link-btn" onclick={() => (editing = false)}>Cancel</button>
      </p>
    {/if}
  {:else if existing}
    <section class="current">
      <h2>Current setup</h2>
      <SeasonSetupChip setup={existing} canEdit onEdit={() => (editing = true)} />
      <p class="hint">
        Last updated {new Date(existing.setAt).toLocaleString()}.
      </p>
      <p class="actions-row">
        <button type="button" onclick={() => goto('/plan')}>Go to Plan wizard →</button>
      </p>
    </section>
  {/if}
</main>

<style>
  .season-page {
    max-width: 760px;
    margin: 0 auto;
    padding: 1.5rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .page-header {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .back-link {
    color: #1f5e3a;
    text-decoration: none;
    font-size: 0.9rem;
    align-self: flex-start;
  }
  .back-link:hover {
    text-decoration: underline;
  }
  .page-header h1 {
    margin: 0;
    color: #1f5e3a;
    font-size: 1.5rem;
  }
  .hint {
    margin: 0;
    color: #4a5a4a;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .success {
    margin: 0;
    padding: 0.6rem 1rem;
    background: #e7f4ec;
    border: 1px solid #1f5e3a;
    border-radius: 6px;
    color: #1f5e3a;
    font-size: 0.95rem;
  }
  .current {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .current h2 {
    margin: 0;
    font-size: 1.1rem;
    color: #1f5e3a;
  }
  .actions-row {
    margin: 0;
    display: flex;
    gap: 0.5rem;
  }
  .actions-row button {
    min-height: 48px;
    padding: 0.5rem 1.25rem;
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  .actions-row button.link-btn {
    background: transparent;
    color: #1f5e3a;
    border: 1px solid #1f5e3a;
  }
  .actions-row button:hover {
    background: #174a2c;
    color: white;
  }
</style>
