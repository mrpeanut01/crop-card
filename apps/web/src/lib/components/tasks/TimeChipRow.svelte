<script lang="ts">
  import {
    DONE_TIME_CHIPS,
    MAX_TASK_MINUTES,
    MIN_TASK_MINUTES,
    formatHours
  } from '$lib/labour/hours';

  interface Props {
    /** Minutes picked, or undefined for no time. */
    value: number | undefined;
    onChange: (minutes: number | undefined) => void;
    disabled?: boolean;
  }
  const { value, onChange, disabled = false }: Props = $props();
  const uid = $props.id();

  const preset = $derived(DONE_TIME_CHIPS.some((c) => c.minutes === value));
  let other = $state(false);
  let raw = $state('');

  function pick(m: number) {
    other = false;
    onChange(value === m ? undefined : m);
  }
  function typed(v: string) {
    raw = v;
    const n = Number(v);
    onChange(
      v.trim() !== '' && Number.isInteger(n) && n >= MIN_TASK_MINUTES && n <= MAX_TASK_MINUTES
        ? n
        : undefined
    );
  }
</script>

<div class="time-row">
  <span class="label" id="time-label-{uid}">Time spent (optional)</span>
  <div class="chips" role="group" aria-labelledby="time-label-{uid}">
    {#each DONE_TIME_CHIPS as c (c.minutes)}
      <button
        type="button"
        class="chip"
        aria-pressed={value === c.minutes}
        {disabled}
        onclick={() => pick(c.minutes)}>{c.label}</button
      >
    {/each}
    <button
      type="button"
      class="chip"
      aria-pressed={other || (value !== undefined && !preset)}
      {disabled}
      onclick={() => {
        other = !other;
        if (!other) typed('');
      }}>Other</button
    >
  </div>
  {#if other}
    <div class="other">
      <label for="time-minutes-{uid}">Minutes</label>
      <input
        id="time-minutes-{uid}"
        type="number"
        inputmode="numeric"
        min={MIN_TASK_MINUTES}
        max={MAX_TASK_MINUTES}
        step="1"
        value={raw}
        oninput={(e) => typed((e.currentTarget as HTMLInputElement).value)}
      />
      {#if value !== undefined && !preset}<span class="as-hours">{formatHours(value)}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .time-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .label {
    font-weight: 600;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    min-height: 48px;
    min-width: 56px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--pill-forest-bg);
    border-color: var(--pill-forest-bd);
  }
  .chip:focus-visible,
  input:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .other {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  input {
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
