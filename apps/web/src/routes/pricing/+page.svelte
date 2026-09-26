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

  const { data } = $props();

  let interval = $state<BillingInterval>('year');

  function cta(plan: PlanId) {
    if (data.signedIn) {
      return {
        label: plan === 'free' ? 'Go to CropCard' : 'Choose in Plan & billing',
        href: plan === 'free' ? '/today' : '/settings/billing',
        primary: plan === 'grower'
      };
    }
    return {
      label: plan === 'free' ? 'Start free' : 'Start free, upgrade any time',
      href: '/',
      primary: plan === 'free'
    };
  }

  const FAQ = [
    {
      q: 'Do I need a card to start?',
      a: `No. Every farm starts on Free, with no card and no end date. Your first ${STARTER_BOOST_DAYS} days include ${formatUsd(STARTER_BOOST_USD)} of AI help so you can try it properly.`
    },
    {
      q: 'What happens when the AI help runs out?',
      a: 'Nothing breaks. Plans, schedules, scans and fills fall back to the same deterministic result CropCard gives without AI, and the monthly amount resets on the 1st, on yearly billing too.'
    },
    {
      q: 'What if a payment fails or I cancel?',
      a: `A failed payment keeps your plan for ${PAST_DUE_GRACE_DAYS} days while the card is retried. If you cancel, the plan runs to the end of the period you paid for. Either way you land on Free with every record, export and helper still in place.`
    },
    {
      q: 'Can I get my money back?',
      a: `Yes. Paid plans carry a ${MONEY_BACK_DAYS}-day money-back guarantee on the first payment. Email hello@cropcard.io and we refund it.`
    },
    {
      q: 'Do helpers cost extra?',
      a: 'No. Seats are included: 2 helpers on Free, 5 on Grower, 15 on Farm. Inspectors never take a seat. If you move to a smaller plan, helpers already on the farm keep their access.'
    }
  ];
</script>

<svelte:head>
  <title>Plans and pricing · CropCard</title>
  <meta
    name="description"
    content="CropCard is free for records, safety checks and exports. Grower and Farm plans add more AI help and helper seats."
  />
</svelte:head>

<main class="pricing" aria-labelledby="pricing-title">
  <nav class="top">
    <a href="/" class="home">CropCard</a>
  </nav>

  <header class="hero">
    <p class="kicker">Plans and pricing</p>
    <h1 id="pricing-title">Free for every farm. Pay only for more AI help.</h1>
    <p class="lede">
      Keep spray, harvest and compliance records on the Free plan for as long as you farm. Grower
      and Farm add more AI planning help, web lookups and helper seats.
    </p>
  </header>

  <PlanCards bind:interval cta={(plan) => cta(plan)} />

  <FreeForever />

  <section class="faq" aria-labelledby="faq-title">
    <h2 id="faq-title">Questions</h2>
    {#each FAQ as item (item.q)}
      <details>
        <summary>{item.q}</summary>
        <p>{item.a}</p>
      </details>
    {/each}
  </section>

  <p class="fine">
    Prices in US dollars. Taxes may apply. Payments are handled by Stripe; CropCard never sees your
    card number.
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
