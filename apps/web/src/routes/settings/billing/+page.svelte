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
  import { createT } from '$lib/i18n';

  const { data } = $props();

  const tr = $derived(createT(data.locale));

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
        ? tr('settings.billing.billedYear', { price: formatUsd(PLANS[current].annualPriceUsd) })
        : tr('settings.billing.billedMonth', { price: formatUsd(PLANS[current].monthlyPriceUsd) })
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
          ? tr('settings.billing.notSetUp')
          : payload.error === 'use-portal'
            ? tr('settings.billing.usePortal')
            : payload.error === 'plan-not-available'
              ? tr('settings.billing.planUnavailable')
              : tr('settings.billing.stripeFailed');
    } catch {
      actionError = tr('settings.billing.offline');
    }
    pending = null;
  }

  function cta(plan: PlanId, period: BillingInterval): PlanCta | null {
    const busy = pending !== null || data.impersonating;
    if (plan === current) return { label: tr('settings.billing.yourPlan'), disabled: true };
    if (plan === 'free') {
      if (!liveSubscription) return null;
      return {
        label: tr('settings.billing.cancelPortal'),
        onclick: () => startBilling('portal'),
        disabled: busy,
        note: tr('settings.billing.cancelNote', { plan: currentName })
      };
    }
    if (!data.billingConfigured) {
      return {
        label: tr('settings.billing.notAvailable'),
        disabled: true,
        note: tr('settings.billing.notSetUp')
      };
    }
    const name = PLANS[plan].name;
    if (liveSubscription) {
      return {
        label: tr('settings.billing.switchTo', { plan: name }),
        onclick: () => startBilling('portal'),
        disabled: busy,
        note: tr('settings.billing.portalNote')
      };
    }
    const offered = (data.checkouts as Record<string, BillingInterval[]>)[plan] ?? [];
    if (!offered.includes(period)) {
      return {
        label:
          period === 'year' ? tr('settings.billing.yearlyNA') : tr('settings.billing.monthlyNA'),
        disabled: true
      };
    }
    return {
      label:
        pending === `checkout:${plan}`
          ? tr('settings.billing.opening')
          : tr('settings.billing.choose', { plan: name }),
      onclick: () => startBilling('checkout', { plan, interval: period }),
      disabled: busy,
      primary: plan === 'grower'
    };
  }
</script>

<svelte:head><title>{tr('settings.billing.pageTitle')}</title></svelte:head>

<SettingsShell title={tr('settings.billing.title')} kicker={tr('settings.billing.kicker')}>
  {#if data.plan.source === 'grace'}
    <div class="banner warn" role="alert" data-testid="past-due-banner">
      <div>
        <strong>{tr('settings.billing.pastDueLead')}</strong>
        {tr('settings.billing.pastDueBody', { plan: currentName, date: graceEndLabel ?? '' })}
      </div>
      <button
        type="button"
        class="billing-btn primary"
        disabled={pending !== null || data.impersonating}
        onclick={() => startBilling('portal')}
      >
        {tr('settings.billing.updatePayment')}
      </button>
    </div>
  {/if}

  {#if data.checkoutResult === 'success'}
    <p class="notice" data-tone="forest" role="status">
      {tr('settings.billing.checkoutDone')}
    </p>
  {:else if data.checkoutResult === 'cancel'}
    <p class="notice" data-tone="neutral" role="status">
      {tr('settings.billing.checkoutCanceled')}
    </p>
  {/if}

  <SettingsSection title={tr('settings.billing.planTitle')} sub={tr('settings.billing.planSub')}>
    <div class="current" data-testid="current-plan">
      <div class="current-head">
        <span class="serif current-name">{currentName}</span>
        {#if data.plan.source === 'override'}
          <Pill tone="sky">{tr('settings.billing.complimentary')}</Pill>
        {:else if data.plan.source === 'grace'}
          <Pill tone="wheat">{tr('settings.billing.retrying')}</Pill>
        {:else if isPaidPlan(current)}
          <Pill tone="forest">{tr('settings.billing.active')}</Pill>
        {:else}
          <Pill tone="forest">{tr('settings.billing.freeForever')}</Pill>
        {/if}
      </div>
      <dl class="facts">
        {#if billedLabel}
          <div>
            <dt>{tr('settings.billing.billed')}</dt>
            <dd>{billedLabel}</dd>
          </div>
        {/if}
        {#if liveSubscription && periodEndLabel}
          <div>
            <dt>{tr('settings.billing.periodEnds')}</dt>
            <dd>{periodEndLabel}</dd>
          </div>
        {/if}
        <div>
          <dt>{tr('settings.billing.seats')}</dt>
          <dd>
            {tr('settings.billing.seatsUsed', { used: data.seats.used, limit: data.seats.limit })}
          </dd>
        </div>
        <div>
          <dt>{tr('settings.billing.aiEach')}</dt>
          <dd>
            {formatUsd(data.ai.planBudget)}{#if data.plan.starterBoost && boostEndLabel}{tr(
                'settings.billing.boostIncl',
                { date: boostEndLabel }
              )}{/if}
          </dd>
        </div>
      </dl>
      <AiBudgetMeter usage={data.ai} isOwner={true} showUpsell={false} />
      {#if data.seats.overLimit}
        <p class="payment-sub">
          {tr('settings.billing.overLimit')}
        </p>
      {/if}
    </div>
  </SettingsSection>

  <SettingsSection
    title={tr('settings.billing.compareTitle')}
    sub={tr('settings.billing.compareSub')}
  >
    <PlanCards bind:interval {current} {cta} />
    {#if actionError}
      <p class="notice" data-tone="rust" role="alert">{actionError}</p>
    {/if}
    {#if data.impersonating}
      <p class="payment-sub">{tr('settings.billing.impersonating')}</p>
    {/if}
  </SettingsSection>

  <div class="free-wrap"><FreeForever /></div>
  <p class="payment-sub cross-link">
    {tr('settings.billing.alertsNote')}
    <a href="/settings/notifications">{tr('settings.billing.chooseAlerts')}</a>.
  </p>

  <SettingsSection
    title={tr('settings.billing.paymentTitle')}
    sub={tr('settings.billing.paymentSub')}
  >
    {#if !data.billingConfigured}
      <div class="payment-row" data-testid="billing-not-configured">
        <div class="payment-text">
          <div class="payment-num">{tr('settings.billing.notSetUpTitle')}</div>
          <div class="payment-sub">
            {tr('settings.billing.nothingToPay')}
          </div>
        </div>
      </div>
    {:else}
      <div class="payment-row">
        <div class="payment-text">
          <div class="payment-num">
            {hasCustomer ? tr('settings.billing.onFile') : tr('settings.billing.noMethod')}
          </div>
          <div class="payment-sub">
            {#if hasCustomer}
              {tr('settings.billing.portalHelp')}
            {:else}
              {tr('settings.billing.pickPlan')}
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
              {pending === 'portal'
                ? tr('settings.billing.openingShort')
                : tr('settings.billing.manage')}
            </button>
          </div>
        {/if}
      </div>
    {/if}
    <p class="fine">
      {tr('settings.billing.fine', { days: MONEY_BACK_DAYS })}
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
