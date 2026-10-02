<script lang="ts">
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import Modal from '$lib/components/ui/Modal.svelte';
  import {
    DONE_TIME_CHIPS,
    MAX_TASK_MINUTES,
    MIN_TASK_MINUTES,
    formatHours
  } from '$lib/labour/hours';

  interface Props {
    open: boolean;
    /** The job being closed, for the sheet's title. */
    title: string;
    busy?: boolean;
    /** Completes the task. `minutes` is undefined for "Done, skip time". */
    onDone: (minutes: number | undefined) => void;
    onClose: () => void;
  }
  const { open, title, busy = false, onDone, onClose }: Props = $props();
  const uid = $props.id();

  let other = $state(false);
  let raw = $state<number | string | null>('');
  const minutes = $derived(Number(raw));
  const valid = $derived(
    raw !== null &&
      String(raw).trim() !== '' &&
      Number.isInteger(minutes) &&
      minutes >= MIN_TASK_MINUTES &&
      minutes <= MAX_TASK_MINUTES
  );

  $effect(() => {
    if (!open) {
      other = false;
      raw = '';
    }
  });

  function finish(m: number | undefined) {
    if (busy) return;
    onDone(m);
  }
  const tr = $derived(createT(page.data?.locale));
</script>

<Modal {open} {onClose} title={tr('tasks.done.title')}>
  <div class="done-sheet" data-testid="done-sheet">
    <p class="job">{title}</p>
    <div class="chips" role="group" aria-label={tr('tasks.done.timeSpent')}>
      {#each DONE_TIME_CHIPS as c (c.minutes)}
        <button
          type="button"
          class="chip"
          disabled={busy}
          aria-label={tr('tasks.done.doneHours', { time: formatHours(c.minutes) })}
          onclick={() => finish(c.minutes)}>{c.label}</button
        >
      {/each}
      <button
        type="button"
        class="chip"
        aria-expanded={other}
        disabled={busy}
        onclick={() => (other = !other)}>{tr('tasks.done.other')}</button
      >
    </div>
    {#if other}
      <div class="other">
        <label for="done-minutes-{uid}">{tr('tasks.done.minutes')}</label>
        <div class="other-row">
          <input
            id="done-minutes-{uid}"
            type="number"
            inputmode="numeric"
            min={MIN_TASK_MINUTES}
            max={MAX_TASK_MINUTES}
            step="1"
            bind:value={raw}
          />
          <span class="as-hours" aria-live="polite"
            >{valid
              ? formatHours(minutes)
              : tr('tasks.done.range', { max: MAX_TASK_MINUTES })}</span
          >
          <button
            type="button"
            class="save"
            disabled={!valid || busy}
            onclick={() => finish(minutes)}>{tr('tasks.done.save')}</button
          >
        </div>
      </div>
    {/if}
    <button type="button" class="skip" disabled={busy} onclick={() => finish(undefined)}
      >{tr('tasks.done.skipTime')}</button
    >
  </div>
</Modal>

<style>
  .done-sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .job {
    margin: 0;
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip,
  .save,
  .skip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 64px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .chip {
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
  }
  .chip[aria-expanded='true'] {
    background: var(--pill-forest-bg);
    border-color: var(--pill-forest-bd);
  }
  .save,
  .skip {
    background: var(--color-forest);
    color: var(--color-cream);
    border: 1px solid var(--color-forest);
  }
  .skip {
    align-self: stretch;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button:focus-visible,
  input:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .other {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .other label {
    font-weight: 600;
  }
  .other-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .other input {
    width: 7rem;
    min-height: 48px;
    padding: 0 var(--space-2);
    font: inherit;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
  }
  .as-hours {
    color: var(--color-ink-soft);
  }
</style>
