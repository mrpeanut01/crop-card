<script lang="ts">
  /** Phase 32E (E1-18). Germinated count for one tray. Works offline: a
   *  count saved with no signal waits in the queue as `seed-start`. */
  import QueuedBadge from '$lib/components/ui/QueuedBadge.svelte';
  import { germinationMax, germinationText } from '$lib/schedule/seedStart';
  import { submitGermination } from '$lib/seedStart/germinationClient';
  import type { SnapshotSeedTray } from '$lib/cards/snapshot';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    tray: SnapshotSeedTray;
    canWrite: boolean;
  }

  const { tray, canWrite }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const max = $derived(germinationMax(tray.cells, tray.seedsPerCell));
  let count = $state(0);
  let saved = $state<number | null>(null);
  let queued = $state(false);
  let error = $state('');
  let busy = $state(false);

  $effect(() => {
    count = tray.germinatedCount ?? 0;
    saved = tray.germinatedCount;
  });

  function step(delta: number) {
    count = Math.max(0, Math.min(max, count + delta));
  }

  async function save() {
    busy = true;
    error = '';
    const out = await submitGermination(tray.id, count);
    busy = false;
    if (out.status === 'error') {
      error = out.message;
      return;
    }
    saved = count;
    queued = out.status === 'queued';
  }
</script>

<div class="stepper" data-testid="germination-stepper">
  <p class="label">
    <strong>{tray.trayLabel ?? tr('cardsui.germ.tray')}</strong>
    <span aria-live="polite" data-testid="germination-text"
      >{germinationText(count, tray.cells, tray.seedsPerCell, page.data?.locale)}</span
    >
    {#if queued}<QueuedBadge />{/if}
  </p>
  {#if canWrite}
    <div class="row">
      <button
        type="button"
        class="btn"
        aria-label={tr('cardsui.germ.fewer')}
        disabled={busy || count <= 0}
        onclick={() => step(-1)}>−</button
      >
      <input
        type="number"
        inputmode="numeric"
        min="0"
        {max}
        aria-label={tr('cardsui.germ.upIn', {
          tray: tray.trayLabel ?? tr('cardsui.germ.thisTray')
        })}
        bind:value={count}
      />
      <button
        type="button"
        class="btn"
        aria-label={tr('cardsui.germ.more')}
        disabled={busy || count >= max}
        onclick={() => step(1)}>+</button
      >
      <button
        type="button"
        class="btn primary"
        disabled={busy || count == null || count === saved}
        onclick={save}>{tr('cardsui.germ.save')}</button
      >
    </div>
  {/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}
</div>

<style>
  .stepper {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .label {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .btn {
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font-size: var(--font-size-body);
    font-weight: 600;
    cursor: pointer;
  }
  .btn.primary {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-paper);
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  input {
    min-height: 48px;
    width: 5.5rem;
    font-size: var(--font-size-body);
    text-align: center;
  }
  .err {
    margin: 0;
    color: var(--color-rust);
  }
</style>
