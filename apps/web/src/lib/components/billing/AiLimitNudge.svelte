<script lang="ts">
  import { PLANS } from '$lib/billing/plans';
  import { aiLimitUpgrade, type AiLimit } from '$lib/billing/aiLimit';

  interface Props {
    limit: AiLimit | null | undefined;
    isOwner: boolean;
  }

  const { limit, isOwner }: Props = $props();

  const upgrade = $derived(aiLimitUpgrade(limit));
  const upgradeName = $derived(upgrade ? PLANS[upgrade].name : null);
</script>

{#if limit && upgradeName}
  <div class="nudge" data-testid="ai-limit-nudge">
    {#if isOwner}
      <a class="upsell" href="/settings/billing" data-testid="ai-upsell">More AI on {upgradeName}</a
      >
    {:else}
      <p class="note">Ask the farm owner about more AI on {upgradeName}.</p>
    {/if}
  </div>
{:else if limit?.detail === 'owner-disabled' && isOwner}
  <div class="nudge" data-testid="ai-limit-nudge">
    <a class="upsell quiet" href="/settings/ai">Turn AI help back on</a>
  </div>
{/if}

<style>
  .nudge {
    margin: 6px 0;
  }
  .note {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.45;
  }
  .upsell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input, 6px);
    background: var(--color-forest-deep);
    color: var(--color-cream, #f8f3e8);
    font-weight: 600;
    text-decoration: none;
    max-width: 100%;
  }
  .upsell.quiet {
    background: transparent;
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
  }
  .upsell:hover {
    filter: brightness(1.08);
  }
</style>
