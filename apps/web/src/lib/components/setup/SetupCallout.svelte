<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    kicker?: string;
    title: string;
    /** When false, the actions are replaced by `askOwner`. */
    canEdit?: boolean;
    askOwner?: string;
    testId?: string;
    children?: Snippet;
    actions?: Snippet;
  }

  const {
    kicker,
    title,
    canEdit = true,
    askOwner = 'Ask the owner to set this up.',
    testId,
    children,
    actions
  }: Props = $props();
  const uid = $props.id();
</script>

<section class="setup-callout" aria-labelledby="{uid}-title" data-testid={testId}>
  {#if kicker}<p class="kicker">{kicker}</p>{/if}
  <h2 id="{uid}-title" class="serif">{title}</h2>
  {#if children}<div class="body">{@render children()}</div>{/if}
  {#if canEdit}
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  {:else}
    <p class="ask-owner" role="note">{askOwner}</p>
  {/if}
</section>

<style>
  .setup-callout {
    margin: var(--space-4) 0;
    padding: var(--card-padding-loose);
    border: 1px solid var(--pill-wheat-bd);
    border-left: 4px solid var(--color-wheat);
    border-radius: var(--radius-card);
    background: var(--color-paper);
  }
  .kicker {
    margin: 0 0 2px;
    font-size: var(--font-size-kicker);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-card-title);
    color: var(--color-forest-deep);
  }
  .body :global(p) {
    margin: 0 0 var(--space-3);
    color: var(--color-ink-soft);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .actions :global(a),
  .actions :global(button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: transparent;
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .actions :global(.primary) {
    border-color: var(--color-forest);
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .ask-owner {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-card);
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
  }
</style>
