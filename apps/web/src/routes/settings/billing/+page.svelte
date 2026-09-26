<script lang="ts">
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import PlanCards, { type PlanCta } from '$lib/components/billing/PlanCards.svelte';
  import FreeForever from '$lib/components/billing/FreeForever.svelte';
  import AiBudgetMeter from '$lib/components/billing/AiBudgetMeter.svelte';
  import {
    MONEY_BACK_DAYS,
    PLANS,
    formatUsd,
    isPaidPlan,
    type BillingInterval,
    type PlanId
  } from '$lib/billing/plans';
  import { fmt } from '$lib/prefsState.svelte';

  const { data } = $props();

  let interval = $state<BillingInterval>('year');
  let pending = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  const current = $derived(data.plan.id as PlanId);
  const currentName = $derived(PLANS[current].name);
  const sub = $derived(data.subscription);
  const liveSubscription = $derived(!!sub?.hasLiveSubscription);
  const hasCustomer = $derived(!!sub?.hasCustomer);
  const periodEndLabel = $derived(sub?.periodEnd ? fmt.instant(sub.periodEnd, 'date') : null);
  const graceEndLabel = $derived(
    data.plan.graceEndsAt ? fmt.instant(data.plan.graceEndsAt, 'date') : null
  );
  const boostEndLabel = $derived(
    data.plan.boostEndsAt ? fmt.instant(data.plan.boostEndsAt, 'date') : null
  );
  const billedLabel = $derived(
    isPaidPlan(current) && data.plan.source !== 'override'
      ? sub?.billingInterval === 'year'
        ? `${formatUsd(PLANS[current].annualPriceUsd)} a year`
        : `${formatUsd(PLANS[current].monthlyPriceUsd)} a month`
      : null
  );

  async function startBilling(kind: 'checkout' | 'portal', body?: Record<string, string>) {
    pending = body ? `${kind}:${body.plan}` : kind;
    actionError = null;
    try {
      const res = await fetch(`/api/billing/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {})
      });
      const payload = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && payload.url) {
        window.location.assign(payload.url);
        return;
      }
      actionError =
        payload.error === 'billing-not-configured'
          ? "Billing isn't set up on this server yet."
          : payload.error === 'use-portal'
            ? 'You already have a plan. Change it in the billing portal.'
            : payload.error === 'plan-not-available'
              ? "That plan isn't available with this billing period yet."
              : 'Stripe could not open the billing page. Try again in a minute.';
    } catch {
      actionError = 'Billing needs a connection. Try again when you are back online.';
    }
    pending = null;
  }

  function cta(plan: PlanId, period: BillingInterval): PlanCta | null {
    const busy = pending !== null || data.impersonating;
    if (plan === current) return { label: 'Your plan', disabled: true };
    if (plan === 'free') {
      if (!liveSubscription) return null;
      return {
        label: 'Cancel in billing portal',
        onclick: () => startBilling('portal'),
        disabled: busy,
        note: `${currentName} runs to the end of the period you paid for, then the farm moves to Free with every record in place.`
      };
    }
    if (!data.billingConfigured) {
      return {
        label: 'Not available yet',
        disabled: true,
        note: "Billing isn't set up on this server yet."
      };
    }
    const name = PLANS[plan].name;
    if (liveSubscription) {
      return {
        label: `Switch to ${name}`,
        onclick: () => startBilling('portal'),
        disabled: busy,
        note: 'Plan changes happen in the Stripe billing portal.'
      };
    }
    const offered = (data.checkouts as Record<string, BillingInterval[]>)[plan] ?? [];
    if (!offered.includes(period)) {
      return {
        label: period === 'year' ? 'Yearly not available yet' : 'Monthly not available yet',
        disabled: true
      };
    }
    return {
      label: pending === `checkout:${plan}` ? 'Opening Stripe…' : `Choose ${name}`,
      onclick: () => startBilling('checkout', { plan, interval: period }),
      disabled: busy,
      primary: plan === 'grower'
    };
  }
</script>

<svelte:head><title>Plan & billing · CropCard</title></svelte:head>

<SettingsShell title="Plan & billing" kicker="Subscription">
  {#if data.plan.source === 'grace'}
    <div class="banner warn" role="alert" data-testid="past-due-banner">
      <div>
        <strong>Your last payment didn't go through.</strong>
        Your {currentName} plan stays on until {graceEndLabel} while Stripe retries the card. After that
        the farm moves to Free; your records stay put.
      </div>
      <button
        type="button"
        class="billing-btn primary"
        disabled={pending !== null || data.impersonating}
        onclick={() => startBilling('portal')}
      >
        Update payment
      </button>
    </div>
  {/if}

  {#if data.checkoutResult === 'success'}
    <p class="notice" data-tone="forest" role="status">
      Checkout complete. Your plan updates here as soon as Stripe confirms the payment.
    </p>
  {:else if data.checkoutResult === 'cancel'}
    <p class="notice" data-tone="neutral" role="status">Checkout canceled. Nothing was charged.</p>
  {/if}

  <SettingsSection title="Your plan" sub="What this farm has today.">
    <div class="current" data-testid="current-plan">
      <div class="current-head">
        <span class="serif current-name">{currentName}</span>
        {#if data.plan.source === 'override'}
          <Pill tone="sky">Complimentary</Pill>
        {:else if data.plan.source === 'grace'}
          <Pill tone="wheat">Payment retrying</Pill>
        {:else if isPaidPlan(current)}
          <Pill tone="forest">Active</Pill>
        {:else}
          <Pill tone="forest">Free forever</Pill>
        {/if}
      </div>
      <dl class="facts">
        {#if billedLabel}
          <div>
            <dt>Billed</dt>
            <dd>{billedLabel}</dd>
          </div>
        {/if}
        {#if liveSubscription && periodEndLabel}
          <div>
            <dt>Current period ends</dt>
            <dd>{periodEndLabel}</dd>
          </div>
        {/if}
        <div>
          <dt>Helper seats</dt>
          <dd>{data.seats.used} of {data.seats.limit} in use</dd>
        </div>
        <div>
          <dt>AI help each month</dt>
          <dd>
            {formatUsd(data.ai.planBudget)}{#if data.plan.starterBoost && boostEndLabel}, including
              a first-month boost until {boostEndLabel}{/if}
          </dd>
        </div>
      </dl>
      <AiBudgetMeter usage={data.ai} isOwner={true} showUpsell={false} />
      {#if data.seats.overLimit}
        <p class="payment-sub">
          More helpers are on the farm than this plan's seats. They keep their access; new invites
          wait until you are under the limit.
        </p>
      {/if}
    </div>
  </SettingsSection>

  <SettingsSection
    title="Compare plans"
    sub="Records, safety and exports are free on every plan. Paid plans add AI help and helper seats."
  >
    <PlanCards bind:interval {current} {cta} />
    {#if actionError}
      <p class="notice" data-tone="rust" role="alert">{actionError}</p>
    {/if}
    {#if data.impersonating}
      <p class="payment-sub">Billing actions are disabled while impersonating.</p>
    {/if}
  </SettingsSection>

  <div class="free-wrap"><FreeForever /></div>
  <p class="payment-sub cross-link">
    Push and email alerts are free on every plan, and email alerts are off until you turn them on.
    <a href="/settings/notifications">Choose your alerts</a>.
  </p>

  <SettingsSection
    title="Payment"
    sub="Checkout and card management are hosted by Stripe; CropCard never sees your card number."
  >
    {#if !data.billingConfigured}
      <div class="payment-row" data-testid="billing-not-configured">
        <div class="payment-text">
          <div class="payment-num">Billing isn't set up on this server</div>
          <div class="payment-sub">
            There's nothing to pay here. Your farm keeps working on the Free plan.
          </div>
        </div>
      </div>
    {:else}
      <div class="payment-row">
        <div class="payment-text">
          <div class="payment-num">
            {hasCustomer ? 'Stripe billing on file' : 'No payment method yet'}
          </div>
          <div class="payment-sub">
            {#if hasCustomer}
              Update your card, download invoices, switch plans or cancel in the Stripe portal.
            {:else}
              Pick a plan above to open Stripe's secure checkout.
            {/if}
          </div>
        </div>
        {#if hasCustomer}
          <div class="payment-actions">
            <button
              type="button"
              class="billing-btn primary"
              disabled={pending !== null || data.impersonating}
              aria-busy={pending === 'portal' || undefined}
              onclick={() => startBilling('portal')}
            >
              {pending === 'portal' ? 'Opening…' : 'Manage billing'}
            </button>
          </div>
        {/if}
      </div>
    {/if}
    <p class="fine">
      Paid plans carry a {MONEY_BACK_DAYS}-day money-back guarantee on the first payment: email
      hello@cropcard.io. AI help resets on the 1st of each month, on yearly billing too. If you
      cancel, the plan runs to the end of the period you paid for.
    </p>
  </SettingsSection>
</SettingsShell>

<style>
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin: 0 0 14px;
    padding: 12px 14px;
    border-radius: 8px;
    font-size: 13.5px;
    line-height: 1.5;
  }
  .banner > div {
    flex: 1 1 240px;
    min-width: 0;
  }
  .banner.warn {
    background: #f3ead2;
    border: 1px solid #e0cf9f;
    color: #4a3b12;
  }
  .current {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 640px;
  }
  .current-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .current-name {
    font-family: var(--font-serif, serif);
    font-size: 24px;
    color: var(--color-forest-deep);
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    margin: 0;
  }
  .facts div {
    min-width: 0;
  }
  .facts dt {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  .facts dd {
    margin: 2px 0 0;
    font-size: 14px;
    color: var(--color-ink);
  }
  .payment-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
  }
  .payment-text {
    flex: 1 1 220px;
    min-width: 0;
  }
  .payment-num {
    font-size: 13.5px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .payment-sub {
    font-size: 12.5px;
    color: var(--color-ink-soft);
    margin: 2px 0 0;
    line-height: 1.5;
  }
  .payment-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .billing-btn {
    min-height: 48px;
    min-width: 48px;
    padding: 0 18px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .billing-btn.primary {
    background: var(--color-forest-deep);
    color: var(--color-cream, #f8f3e8);
    border: 1.5px solid var(--color-forest-deep);
  }
  .billing-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .notice {
    margin: 10px 0;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    border: 1px solid var(--color-divider);
  }
  .notice[data-tone='forest'] {
    background: #e5eedf;
    color: #1f3a28;
    border-color: #c9dbc0;
  }
  .notice[data-tone='rust'] {
    background: #f1d9ce;
    color: #8a341b;
    border-color: #e2b69e;
  }
  .notice[data-tone='neutral'] {
    background: #e9dfcc;
    color: #4a4f46;
  }
  .free-wrap {
    margin: 0 0 16px;
  }
  .cross-link {
    margin: 0 0 16px;
    font-size: 14px;
  }
  .fine {
    margin: 12px 0 0;
    font-size: 12.5px;
    color: var(--color-ink-muted);
    line-height: 1.5;
  }
  .serif {
    font-family: var(--font-serif, serif);
  }
</style>
