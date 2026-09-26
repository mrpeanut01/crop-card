<script lang="ts" module>
  export interface PlanCta {
    label: string;
    href?: string;
    onclick?: () => void;
    disabled?: boolean;
    primary?: boolean;
    note?: string;
  }
</script>

<script lang="ts">
  import { Check } from 'lucide-svelte';
  import {
    AI_BUDGET_EXAMPLES,
    PLANS,
    PLAN_HIGHLIGHTS,
    PLAN_IDS,
    annualMonthlyEquivalent,
    formatUsd,
    type BillingInterval,
    type PlanId
  } from '$lib/billing/plans';

  interface Props {
    interval: BillingInterval;
    current?: PlanId | null;
    cta: (plan: PlanId, interval: BillingInterval) => PlanCta | null;
  }

  let { interval = $bindable('year'), current = null, cta }: Props = $props();

  function priceLine(plan: PlanId): { big: string; small: string } {
    const def = PLANS[plan];
    if (def.monthlyPriceUsd === 0) return { big: '$0', small: 'forever, no card needed' };
    if (interval === 'year') {
      return {
        big: formatUsd(annualMonthlyEquivalent(plan)),
        small: `a month, billed ${formatUsd(def.annualPriceUsd)} a year`
      };
    }
    return { big: formatUsd(def.monthlyPriceUsd), small: 'a month, billed monthly' };
  }

  const savings = $derived(
    Math.round((1 - PLANS.grower.annualPriceUsd / (PLANS.grower.monthlyPriceUsd * 12)) * 100)
  );
</script>

<div class="plans">
  <div class="toggle" role="radiogroup" aria-label="Billing period">
    <button
      type="button"
      role="radio"
      aria-checked={interval === 'year'}
      class:on={interval === 'year'}
      onclick={() => (interval = 'year')}
      data-testid="interval-year"
    >
      Yearly <span class="save">save {savings}%</span>
    </button>
    <button
      type="button"
      role="radio"
      aria-checked={interval === 'month'}
      class:on={interval === 'month'}
      onclick={() => (interval = 'month')}
      data-testid="interval-month"
    >
      Monthly
    </button>
  </div>

  <div class="grid">
    {#each PLAN_IDS as plan (plan)}
      {@const price = priceLine(plan)}
      {@const action = cta(plan, interval)}
      <article
        class="card"
        class:current={current === plan}
        class:featured={plan === 'grower'}
        data-testid="plan-card-{plan}"
        aria-labelledby="plan-name-{plan}"
      >
        <header>
          <h3 id="plan-name-{plan}" class="name">{PLANS[plan].name}</h3>
          {#if current === plan}<span class="badge">Your plan</span>{/if}
        </header>
        <div class="price">
          <span class="big">{price.big}</span>
          <span class="small">{price.small}</span>
        </div>
        <ul>
          {#each PLAN_HIGHLIGHTS[plan] as line (line)}
            <li><Check size={14} strokeWidth={2.25} aria-hidden="true" /> <span>{line}</span></li>
          {/each}
        </ul>
        <p class="budget">{AI_BUDGET_EXAMPLES[plan]}</p>
        {#if action}
          {#if action.href && !action.disabled}
            <a
              class="cta"
              class:primary={action.primary}
              href={action.href}
              data-testid="plan-cta-{plan}">{action.label}</a
            >
          {:else}
            <button
              type="button"
              class="cta"
              class:primary={action.primary}
              disabled={action.disabled}
              onclick={action.onclick}
              data-testid="plan-cta-{plan}">{action.label}</button
            >
          {/if}
          {#if action.note}<p class="note">{action.note}</p>{/if}
        {/if}
      </article>
    {/each}
  </div>
</div>

<style>
  .plans {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .toggle {
    display: inline-flex;
    align-self: center;
    padding: 4px;
    gap: 4px;
    border-radius: 999px;
    background: var(--color-divider-soft, #e9dfcc);
    border: 1px solid var(--color-divider, #d9cfb7);
  }
  .toggle button {
    min-height: 48px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--color-ink-soft, #4a4f46);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .toggle button.on {
    background: var(--color-paper, #fdfaf2);
    color: var(--color-forest-deep, #1f3a28);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
  .save {
    font-size: 12px;
    color: var(--color-forest, #2c5237);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    border-radius: 10px;
    border: 1px solid var(--color-divider, #d9cfb7);
    background: var(--color-paper, #fdfaf2);
    min-width: 0;
  }
  .card.featured {
    border: 1.5px solid var(--color-forest, #2c5237);
  }
  .card.current {
    background: rgba(141, 174, 138, 0.16);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .name {
    margin: 0;
    font-family: var(--font-serif, serif);
    font-size: 22px;
    color: var(--color-forest-deep, #1f3a28);
  }
  .badge {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-forest-deep, #1f3a28);
    background: #e5eedf;
    border-radius: 999px;
    padding: 2px 10px;
  }
  .price {
    display: flex;
    flex-direction: column;
  }
  .big {
    font-family: var(--font-serif, serif);
    font-size: 34px;
    font-weight: 600;
    color: var(--color-ink, #1a1f1a);
    line-height: 1.1;
  }
  .small {
    font-size: 13px;
    color: var(--color-ink-muted, #7a7f75);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13.5px;
    color: var(--color-ink-soft, #4a4f46);
    line-height: 1.45;
  }
  li {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  li :global(svg) {
    flex: none;
    margin-top: 3px;
    color: var(--color-forest, #2c5237);
  }
  .budget {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-ink-muted, #7a7f75);
    line-height: 1.45;
  }
  .cta {
    margin-top: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input, 6px);
    border: 1.5px solid var(--color-divider, #d9cfb7);
    background: var(--color-paper, #fdfaf2);
    color: var(--color-ink, #1a1f1a);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    text-align: center;
  }
  .cta.primary {
    background: var(--color-forest-deep, #1f3a28);
    border-color: var(--color-forest-deep, #1f3a28);
    color: var(--color-cream, #f8f3e8);
  }
  .cta:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--color-ink-muted, #7a7f75);
    line-height: 1.4;
  }
  @media (max-width: 820px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
