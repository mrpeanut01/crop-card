<script lang="ts">
  import PlanCards from '$lib/components/billing/PlanCards.svelte';
  import FreeForever from '$lib/components/billing/FreeForever.svelte';
  import {
    MONEY_BACK_DAYS,
    PAST_DUE_GRACE_DAYS,
    STARTER_BOOST_DAYS,
    STARTER_BOOST_USD,
    formatUsd,
    type BillingInterval,
    type PlanId
  } from '$lib/billing/plans';

  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));

  let interval = $state<BillingInterval>('year');

  function cta(plan: PlanId) {
    if (data.signedIn) {
      return {
        label: plan === 'free' ? tr('pricing.ctaGo') : tr('pricing.ctaChoose'),
        href: plan === 'free' ? '/today' : '/settings/billing',
        primary: plan === 'grower'
      };
    }
    return {
      label: plan === 'free' ? tr('pricing.ctaStartFree') : tr('pricing.ctaStartUpgrade'),
      href: '/',
      primary: plan === 'free'
    };
  }

  const FAQ = $derived([
    {
      q: tr('pricing.faq1.q'),
      a: tr('pricing.faq1.a', {
        days: STARTER_BOOST_DAYS,
        amount: formatUsd(STARTER_BOOST_USD)
      })
    },
    { q: tr('pricing.faq2.q'), a: tr('pricing.faq2.a') },
    { q: tr('pricing.faq3.q'), a: tr('pricing.faq3.a', { days: PAST_DUE_GRACE_DAYS }) },
    { q: tr('pricing.faq4.q'), a: tr('pricing.faq4.a', { days: MONEY_BACK_DAYS }) },
    { q: tr('pricing.faq5.q'), a: tr('pricing.faq5.a') }
  ]);
</script>

<svelte:head>
  <title>{tr('pricing.title')}</title>
  <meta name="description" content={tr('pricing.description')} />
</svelte:head>

<main class="pricing" aria-labelledby="pricing-title">
  <nav class="top">
    <a href="/" class="home">CropCard</a>
  </nav>

  <header class="hero">
    <p class="kicker">{tr('pricing.kicker')}</p>
    <h1 id="pricing-title">{tr('pricing.h1')}</h1>
    <p class="lede">
      {tr('pricing.lede')}
    </p>
  </header>

  <PlanCards bind:interval cta={(plan) => cta(plan)} />

  <FreeForever />

  <section class="faq" aria-labelledby="faq-title">
    <h2 id="faq-title">{tr('pricing.faqTitle')}</h2>
    {#each FAQ as item (item.q)}
      <details>
        <summary>{item.q}</summary>
        <p>{item.a}</p>
      </details>
    {/each}
  </section>

  <p class="fine">
    {tr('pricing.fine')}
  </p>
</main>

<style>
  .pricing {
    max-width: 1040px;
    margin: 0 auto;
    padding: 16px 16px 48px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    color: var(--color-ink, #1a1f1a);
    box-sizing: border-box;
    width: 100%;
    overflow-wrap: anywhere;
  }
  .top {
    display: flex;
  }
  .home {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-family: var(--font-serif, serif);
    font-size: 20px;
    font-weight: 600;
    color: var(--color-forest-deep, #1f3a28);
    text-decoration: none;
  }
  .hero {
    text-align: center;
  }
  .kicker {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ink-muted, #7a7f75);
  }
  h1 {
    margin: 6px 0 8px;
    font-family: var(--font-serif, serif);
    font-size: clamp(26px, 5vw, 38px);
    line-height: 1.15;
    color: var(--color-forest-deep, #1f3a28);
  }
  .lede {
    margin: 0 auto;
    max-width: 640px;
    font-size: 15px;
    line-height: 1.55;
    color: var(--color-ink-soft, #4a4f46);
  }
  .faq h2 {
    font-family: var(--font-serif, serif);
    color: var(--color-forest-deep, #1f3a28);
    font-size: 22px;
    margin: 0 0 8px;
  }
  details {
    border-bottom: 1px solid var(--color-divider, #d9cfb7);
  }
  summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    font-weight: 600;
    cursor: pointer;
  }
  details p {
    margin: 0 0 12px;
    font-size: 14px;
    line-height: 1.55;
    color: var(--color-ink-soft, #4a4f46);
  }
  .fine {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-ink-muted, #7a7f75);
    text-align: center;
  }
</style>
