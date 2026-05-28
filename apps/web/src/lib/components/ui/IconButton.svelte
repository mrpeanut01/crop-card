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
  /* #146 / CT-H-004 — CLAUDE.md invariant: field UI must be one-handed-
     glove operable (>=48dp tap targets). The visible icon stays 16-20px
     via the consumer's <svg size> prop; the tap area expands via the
     button's own min-height/min-width. */
  .icon-btn {
    min-width: 48px;
    min-height: 48px;
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
