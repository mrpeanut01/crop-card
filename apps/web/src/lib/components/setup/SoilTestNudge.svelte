<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { hintState, initHints, markHintSeen } from '$lib/client/hints';
  import { cardHref, cardKey } from '$lib/cards/model';
  import type { SetupSoilTestResult, SoilTestPlace } from '$lib/fertility/soilTestForm';
  import SetupSheet from './SetupSheet.svelte';
  import SetupSoilTest from './SetupSoilTest.svelte';

  interface Props {
    places: SoilTestPlace[];
  }

  const { places }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const KEY = 'soil_test_nudge';
  let mounted = $state(false);
  let sheetOpen = $state(false);
  let saved = $state<SetupSoilTestResult | null>(null);

  const visible = $derived(
    mounted && (saved !== null || ($hintState.ready && !$hintState.seen.has(KEY)))
  );

  onMount(() => {
    mounted = true;
    void initHints(page.data?.user?.id ?? null);
  });

  function dismiss() {
    void markHintSeen(KEY);
  }

  function onSaved(r: SetupSoilTestResult) {
    sheetOpen = false;
    saved = r;
    void markHintSeen(KEY);
  }
</script>

{#if visible}
  <aside class="soil-nudge" aria-labelledby="soil-nudge-title" data-testid="soil-test-nudge">
    {#if saved}
      <p id="soil-nudge-title" class="title" role="status">{tr('setup.soil.saved')}</p>
      <p class="body">
        {tr('setup.soil.savedBody')}
        <a href={cardHref('soilTest', cardKey('soilTest', saved.soilTestId))}
          >{tr('setup.soil.openCard')}</a
        >
      </p>
      <button type="button" class="ghost" onclick={() => (saved = null)}>{tr('setup.close')}</button
      >
    {:else}
      <p id="soil-nudge-title" class="title">{tr('setup.soil.have')}</p>
      <p class="body">
        {tr('setup.soil.haveBody')}
      </p>
      <div class="actions">
        <button type="button" class="primary" onclick={() => (sheetOpen = true)}>
          {tr('setup.soil.add')}
        </button>
        <button type="button" class="ghost" onclick={dismiss}>{tr('setup.nudges.notNow')}</button>
      </div>
    {/if}
  </aside>
{/if}

<SetupSheet
  open={sheetOpen}
  kicker={tr('setup.soil.kicker')}
  title={tr('setup.soil.add')}
  onClose={() => (sheetOpen = false)}
  onDone={onSaved}
>
  {#snippet children(done)}
    <SetupSoilTest {places} canEdit={true} onDone={done} />
  {/snippet}
</SetupSheet>

<style>
  .soil-nudge {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: var(--space-3) 0;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-divider);
    border-left: 4px solid var(--color-wheat);
    border-radius: var(--radius-card);
    background: var(--color-paper);
  }
  .title {
    margin: 0;
    font-weight: 600;
    color: var(--color-ink);
  }
  .body {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  button {
    min-height: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    border: none;
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .ghost {
    align-self: flex-start;
    border: 1px solid var(--color-divider);
    background: transparent;
    color: var(--color-ink);
  }
</style>
