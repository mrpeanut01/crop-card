<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLSelectAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLSelectAttributes, 'class'> {
    label: string;
    hint?: string;
    error?: string;
    value?: HTMLSelectAttributes['value'];
    children: Snippet;
  }

  // Same on the server and in the browser, so hydration keeps the label's
  // `for` and works outside a secure context (no crypto.randomUUID).
  const uid = $props.id();

  let {
    label,
    hint,
    error,
    id = `select-${uid}`,
    value = $bindable(),
    children,
    ...rest
  }: Props = $props();

  const hintId = $derived(hint ? `${id}-hint` : undefined);
  const errId = $derived(error ? `${id}-err` : undefined);
  const describedBy = $derived([hintId, errId].filter(Boolean).join(' ') || undefined);
</script>

<div class="field" class:hasError={!!error}>
  <label for={id}>{label}</label>
  <select
    {id}
    bind:value
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={describedBy}
    {...rest}
  >
    {@render children()}
  </select>
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
  select {
    height: 40px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-size: var(--font-size-body);
  }
  select:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 1px;
    border-color: var(--color-forest);
  }
  .hasError select {
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
