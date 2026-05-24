<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Variant = 'primary' | 'ghost' | 'danger';
  type Size = 'md' | 'sm';

  interface Props extends Omit<HTMLButtonAttributes, 'children'> {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
    iconLeft?: Snippet;
    children: Snippet;
  }

  const {
    variant = 'primary',
    size = 'md',
    loading = false,
    iconLeft,
    children,
    disabled,
    type = 'button',
    ...rest
  }: Props = $props();
</script>

<button
  {type}
  class="btn {variant} {size}"
  class:loading
  disabled={disabled || loading}
  aria-busy={loading || undefined}
  {...rest}
>
  {#if iconLeft}<span class="icon">{@render iconLeft()}</span>{/if}
  <span class="label">{@render children()}</span>
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: var(--radius-input);
    font-size: var(--font-size-body);
    font-weight: 600;
    letter-spacing: 0.01em;
    border: 1px solid transparent;
    min-height: var(--btn-height-min-tap);
    padding: 0 18px;
    transition: background 0.12s, border-color 0.12s, opacity 0.12s;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .md {
    height: var(--btn-height-primary);
  }
  .sm {
    height: var(--btn-height-ghost);
    padding: 0 14px;
    font-weight: 500;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .primary:hover:not(:disabled) {
    background: var(--color-forest-deep);
  }
  .ghost {
    background: transparent;
    color: var(--color-forest-deep);
    border-color: var(--color-divider);
  }
  .ghost:hover:not(:disabled) {
    background: var(--color-divider-soft);
  }
  .danger {
    background: var(--color-rust);
    color: var(--color-cream);
  }
  .danger:hover:not(:disabled) {
    background: #8a341b;
  }
  .icon {
    display: inline-flex;
    align-items: center;
  }
  /* Spinner could go here later — for now aria-busy is the signal. */
  .loading .label {
    opacity: 0.7;
  }
</style>
