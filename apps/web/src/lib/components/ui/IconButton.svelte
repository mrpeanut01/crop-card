<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

  type ButtonProps = Omit<HTMLButtonAttributes, 'class'> & {
    href?: undefined;
    /** Required: screen-reader label since the button has no text. */
    ariaLabel: string;
    /** Tone of the button. */
    tone?: 'neutral' | 'forest' | 'rust';
    icon: Snippet;
  };

  type AnchorProps = Omit<HTMLAnchorAttributes, 'class'> & {
    href: string;
    ariaLabel: string;
    tone?: 'neutral' | 'forest' | 'rust';
    icon: Snippet;
  };

  // Either an <a> when `href` is set or a <button> otherwise.
  // The `ariaLabel` prop is TS-required — clickthrough audit found unlabeled
  // icon buttons (UC-08 settings gear) and the type system now blocks them.
  type Props = ButtonProps | AnchorProps;

  const { ariaLabel, tone = 'neutral', icon, href, ...rest }: Props = $props();
</script>

{#if href}
  <a
    {href}
    class="icon-btn {tone}"
    aria-label={ariaLabel}
    title={ariaLabel}
    {...rest as HTMLAnchorAttributes}
  >
    {@render icon()}
  </a>
{:else}
  <button
    type="button"
    class="icon-btn {tone}"
    aria-label={ariaLabel}
    title={ariaLabel}
    {...rest as HTMLButtonAttributes}
  >
    {@render icon()}
  </button>
{/if}

<style>
  .icon-btn {
    width: 36px;
    height: 36px;
    min-width: 0;
    min-height: 0;
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink-soft);
    display: inline-grid;
    place-items: center;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s,
      border-color 0.12s;
  }
  .icon-btn:hover {
    background: var(--color-divider-soft);
    color: var(--color-ink);
  }
  .forest {
    color: var(--color-forest);
  }
  .forest:hover {
    color: var(--color-forest-deep);
  }
  .rust {
    color: var(--color-rust);
  }
</style>
