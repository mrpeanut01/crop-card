<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLTextareaAttributes, 'class'> {
    label: string;
    hint?: string;
    error?: string;
    value?: string;
  }

  let {
    label,
    hint,
    error,
    id = `textarea-${crypto.randomUUID().slice(0, 8)}`,
    rows = 4,
    value = $bindable(''),
    ...rest
  }: Props = $props();

  const hintId = $derived(hint ? `${id}-hint` : undefined);
  const errId = $derived(error ? `${id}-err` : undefined);
  const describedBy = $derived([hintId, errId].filter(Boolean).join(' ') || undefined);
</script>

<div class="field" class:hasError={!!error}>
  <label for={id}>{label}</label>
  <textarea
    {id}
    {rows}
    bind:value
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={describedBy}
    {...rest}
  ></textarea>
  {#if hint && !error}<div id={hintId} class="hint">{hint}</div>{/if}
  {#if error}<div id={errId} class="error" role="alert">{error}</div>{/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
    font-weight: 500;
  }
  textarea {
    padding: 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-size: var(--font-size-body);
    resize: vertical;
  }
  textarea:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 1px;
    border-color: var(--color-forest);
  }
  .hasError textarea {
    border-color: var(--color-rust);
  }
  .hint {
    font-size: var(--font-size-caption);
    color: var(--color-ink-muted);
  }
  .error {
    font-size: var(--font-size-caption);
    color: var(--color-rust);
  }
</style>
