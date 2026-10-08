<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { chemistryClassLabel } from '$lib/records/chemistryClassLabel';
  import { fmt } from '$lib/prefsState.svelte';

  interface SprayerOption {
    id: string;
    label: string;
    calibratedGpa: number | null;
    lastChemistryClass?: string;
    lastDeconAt?: number;
    tankGal?: number;
  }

  interface Props {
    sprayers: SprayerOption[];
    selectedId: string;
    canEdit: boolean;
    onAdd: () => void;
    onPick?: (sprayer: SprayerOption) => void;
  }

  let { sprayers, selectedId = $bindable(), canEdit, onAdd, onPick }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  function pick(s: SprayerOption) {
    selectedId = s.id;
    onPick?.(s);
  }
</script>

{#if sprayers.length === 0}
  <div class="sprayer-empty" data-testid="sprayer-empty">
    <p>
      <strong>{tr('sprayui.sprayer.emptyLead')}</strong>
      {tr('sprayui.sprayer.emptyBody')}
    </p>
    {#if canEdit}
      <button type="button" class="add" onclick={onAdd}>{tr('sprayui.sprayer.add')}</button>
    {:else}
      <p class="ask-owner" role="note">{tr('sprayui.sprayer.askOwner')}</p>
    {/if}
  </div>
{:else}
  <p class="hint">{tr('sprayui.sprayer.pickHint')}</p>
  <div class="sprayers" role="group" aria-label={tr('sprayui.dp.sprayer')}>
    {#each sprayers as s (s.id)}
      <button
        type="button"
        class="sprayer"
        class:selected={selectedId === s.id}
        aria-pressed={selectedId === s.id}
        data-sprayer-id={s.id}
        onclick={() => pick(s)}
      >
        <strong>{s.label}</strong>
        <small
          >{s.tankGal ? tr('sprayui.sprayer.tank', { gal: s.tankGal }) : ''}{s.calibratedGpa != null
            ? fmt.label(s.calibratedGpa, 'volumePerArea')
            : tr('sprayui.sprayer.uncalibrated')}</small
        >
        {#if s.lastChemistryClass}
          <small class="warn"
            >{tr('sprayui.sprayer.lastLoad', {
              class: chemistryClassLabel(s.lastChemistryClass, page.data?.locale)
            })}</small
          >
        {:else}
          <small class="ok">{tr('sprayui.sprayer.clean')}</small>
        {/if}
        {#if s.lastDeconAt}
          <small>{tr('sprayui.sprayer.lastDecon', { date: fmt.instant(s.lastDeconAt) })}</small>
        {/if}
      </button>
    {/each}
  </div>
  {#if canEdit}
    <button type="button" class="add secondary" onclick={onAdd}>{tr('sprayui.sprayer.add')}</button>
  {/if}
{/if}

<style>
  .sprayers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
    gap: 8px;
    margin: 0 0 10px;
  }
  .sprayer {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-height: 48px;
    padding: 10px 12px;
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    background: var(--color-paper);
    color: var(--color-ink);
    text-align: left;
    cursor: pointer;
  }
  .sprayer.selected {
    border: 2px solid var(--color-forest);
    background: var(--color-cream);
  }
  .sprayer small.warn {
    color: var(--color-rust);
  }
  .sprayer small.ok {
    color: var(--color-forest);
  }
  .add {
    min-height: 48px;
  }
  .hint {
    color: var(--color-ink-soft);
    margin: 0 0 8px;
  }
  .ask-owner {
    color: var(--color-ink-soft);
  }
</style>
