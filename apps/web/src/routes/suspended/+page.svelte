<svelte:head><title>Tenant suspended · CropCard</title></svelte:head>

<section class="suspended">
  <h1>Tenant suspended</h1>
  <p>
    This Owner account is suspended and most functionality is locked. Re-activate by updating your
    billing details, or reach out to support.
  </p>
  <div class="cta-row">
    <a class="primary" href="/settings/billing">Manage billing →</a>
    <a class="ghost" href="mailto:support@cropcard.local">Contact support</a>
  </div>
</section>

<style>
  .suspended {
    max-width: 480px;
    margin: 80px auto;
    text-align: center;
    padding: 32px;
    background: var(--color-paper, #fff);
    border: 1px solid var(--color-divider);
    border-radius: 12px;
  }
  h1 {
    margin: 0 0 0.5rem;
    color: var(--color-rust, #ba4b38);
  }
  p {
    color: var(--color-ink-soft);
    margin: 0 0 1.5rem;
    line-height: 1.5;
  }
  .cta-row {
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-cream, #fff8e1);
    padding: 0.6rem 1.25rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
  }
  .ghost {
    color: var(--color-forest);
    border: 1px solid var(--color-divider);
    padding: 0.6rem 1.25rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
  }
</style>
