<script lang="ts">
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  const tr = $derived(createT(page.data?.locale));
</script>

<svelte:head><title>{tr('entry.suspended.title')}</title></svelte:head>

<section class="suspended" data-testid="suspended">
  <h1>{tr('entry.suspended.h1')}</h1>
  <p>
    {tr('entry.suspended.body')}
  </p>
  <div class="cta-row">
    <a class="primary" href="/records" data-testid="suspended-records"
      >{tr('entry.suspended.records')}</a
    >
    <a class="ghost" href="/api/account/export.json" data-testid="suspended-export"
      >{tr('entry.suspended.export')}</a
    >
    <a class="ghost" href="mailto:hello@cropcard.io">{tr('entry.suspended.email')}</a>
  </div>
  <p class="small">
    {tr('entry.suspended.billingQ')}
    <a href="/settings/billing">{tr('entry.suspended.billingLink')}</a>.
  </p>
</section>

<style>
  .suspended {
    box-sizing: border-box;
    width: calc(100% - 32px);
    max-width: 480px;
    margin: 64px auto;
    text-align: center;
    padding: 28px 20px;
    background: var(--color-paper, #fff);
    border: 1px solid var(--color-divider);
    border-radius: 12px;
  }
  h1 {
    margin: 0 0 0.5rem;
    color: var(--color-ink, #1d2420);
  }
  p {
    color: var(--color-ink-soft);
    margin: 0 0 1.25rem;
    line-height: 1.5;
  }
  .small {
    margin: 1.25rem 0 0;
    font-size: 14px;
  }
  .small a {
    color: var(--color-forest-deep, var(--color-forest));
    font-weight: 600;
  }
  .cta-row {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: stretch;
  }
  .primary,
  .ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 1.25rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
  }
  .primary {
    background: var(--color-forest-deep, var(--color-forest));
    color: var(--color-cream, #fff8e1);
  }
  .ghost {
    color: var(--color-forest-deep, var(--color-forest));
    border: 1px solid var(--color-divider);
  }
</style>
