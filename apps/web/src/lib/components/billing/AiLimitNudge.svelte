<script lang="ts">
  import { PLANS } from '$lib/billing/plans';
  import { aiLimitUpgrade, type AiLimit } from '$lib/billing/aiLimit';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';

  interface Props {
    limit: AiLimit | null | undefined;
    isOwner: boolean;
  }

  const { limit, isOwner }: Props = $props();

  const tr = $derived(createT(page.data?.locale));

  const upgrade = $derived(aiLimitUpgrade(limit));
  const upgradeName = $derived(upgrade ? PLANS[upgrade].name : null);
</script>

{#if limit && upgradeName}
  <div class="nudge" data-testid="ai-limit-nudge">
    {#if isOwner}
      <a class="upsell" href="/settings/billing" data-testid="ai-upsell"
        >{tr('billing.nudge.more', { plan: upgradeName })}</a
      >
    {:else}
      <p class="note">{tr('billing.nudge.askOwner', { plan: upgradeName })}</p>
    {/if}
  </div>
{:else if limit?.detail === 'owner-disabled' && isOwner}
  <div class="nudge" data-testid="ai-limit-nudge">
    <a class="upsell quiet" href="/settings/ai">{tr('billing.nudge.turnOn')}</a>
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
