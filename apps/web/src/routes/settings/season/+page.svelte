<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { ChevronRight } from 'lucide-svelte';
  import type { PageData } from './$types';
  import Kicker from '$lib/components/ui/Kicker.svelte';
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
  <title>Season setup · CropCard</title>
</svelte:head>

<main class="season-page">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="/settings">Settings</a>
    <ChevronRight size={13} aria-hidden="true" />
    <span>Season setup</span>
  </nav>
  <header class="page-header">
    <Kicker>Settings · Season {data.currentYear}</Kicker>
    <h1 class="serif">Season setup.</h1>
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

  <section class="closeout-link">
    <h2>Prep next season</h2>
    <p class="hint">
      Carry the whole operation into {data.currentYear + 1}: rotation checks, surviving stock, a
      pre-seeded planting draft, and a sprayer calibration hand-off. Deterministic — no AI.
    </p>
    <a class="prep-cta" href="/settings/season/carry-forward"
      >Prep the {data.currentYear + 1} season →</a
    >
  </section>

  <section class="closeout-link">
    <h2>End of season</h2>
    <p class="hint">
      Done for the {data.currentYear} year? Close the season to lock every {data.currentYear} record against
      late edits.
    </p>
    <a class="closeout-cta" href="/settings/season/close-out"
      >Close the {data.currentYear} season →</a
    >
  </section>
</main>

<style>
  .closeout-link {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 1rem;
    border-top: 1px dashed #cbbf9a;
  }
  .closeout-link h2 {
    margin: 0;
    font-size: 1.1rem;
    color: #1f5e3a;
  }
  .closeout-cta {
    align-self: flex-start;
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    padding: 0.55rem 1.25rem;
    background: transparent;
    color: #8a3b34;
    border: 1px solid #8a3b34;
    border-radius: 8px;
    font-weight: 600;
    text-decoration: none;
  }
  .prep-cta {
    align-self: flex-start;
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    padding: 0.55rem 1.25rem;
    background: #1f5e3a;
    color: white;
    border-radius: 8px;
    font-weight: 600;
    text-decoration: none;
  }
  .prep-cta:hover {
    background: #174a2c;
  }
  .closeout-cta:hover {
    background: #f6ecea;
  }
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
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--color-ink-muted);
    margin-bottom: 4px;
  }
  .breadcrumb a {
    color: var(--color-forest);
    text-decoration: none;
  }
  .breadcrumb a:hover {
    text-decoration: underline;
  }
  .page-header h1 {
    margin: 6px 0 0;
    font-family: var(--font-serif, serif);
    font-size: 30px;
    color: var(--color-forest-deep);
    letter-spacing: -0.02em;
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
