<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  // Label is required (TS-enforced, not optional) to structurally prevent
  // the clickthrough-audit a11y findings (UC-05, UC-06) — bare spinbutton
  // and placeholder-only inputs can't reach the codebase via this component.
  interface Props extends Omit<HTMLInputAttributes, 'class'> {
    label: string;
    hint?: string;
    error?: string;
    value?: HTMLInputAttributes['value'];
  }

  let {
    label,
    hint,
    error,
    id = `input-${crypto.randomUUID().slice(0, 8)}`,
    type = 'text',
    value = $bindable(),
    ...rest
  }: Props = $props();

  const hintId = $derived(hint ? `${id}-hint` : undefined);
  const errId = $derived(error ? `${id}-err` : undefined);
  const describedBy = $derived([hintId, errId].filter(Boolean).join(' ') || undefined);
</script>

<div class="field" class:hasError={!!error}>
  <label for={id}>{label}</label>
  <input
    {id}
    {type}
    bind:value
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={describedBy}
    {...rest}
  />
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
  input {
    height: 40px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-size: var(--font-size-body);
  }
  input:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 1px;
    border-color: var(--color-forest);
  }
  .hasError input {
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
