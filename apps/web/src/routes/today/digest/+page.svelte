<script lang="ts">
  import '$lib/cards/print.css';
  import CardView from '$lib/components/cards/CardView.svelte';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import { createT } from '$lib/i18n';

  const { data } = $props();
  const prefs = $derived(currentPrefs());
  const tr = $derived(createT(data.locale));

  function print() {
    const previous = document.title;
    document.title = data.card.title;
    window.print();
    document.title = previous;
  }
</script>

<svelte:head><title>{tr('digest.page.title')}</title></svelte:head>

<div class="no-print">
  <nav class="crumbs" aria-label={tr('digest.page.breadcrumb')}>
    <a href="/today">{tr('digest.page.today')}</a>
    <span aria-hidden="true">›</span>
    <span>{tr('digest.page.crumb')}</span>
  </nav>
  <div class="one">
    <CardView card={data.card} {prefs} />
  </div>
  <div class="actions">
    <button type="button" class="btn primary" onclick={print} data-testid="digest-print">
      {tr('digest.page.print')}
    </button>
    <a class="btn ghost" href="/settings/notifications">{tr('digest.page.everyMonday')}</a>
  </div>
</div>

<div class="card-print-sheet layout-letter-4up" data-layout="letter">
  <div class="sheet-page full-page flow">
    <div class="print-cell">
      <CardView card={data.card} variant="print" {prefs} complete />
    </div>
  </div>
</div>

<style>
  .card-print-sheet .sheet-page.flow,
  .card-print-sheet .sheet-page.flow :global(.print-cell),
  .card-print-sheet .sheet-page.flow :global(.cardview) {
    height: auto;
    overflow: visible;
  }
  .crumbs {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
  }
  .one {
    max-width: 40rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 1rem 0;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 1.1rem;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.95rem;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
  }
  .btn.primary {
    background: var(--color-forest-deep);
    border-color: var(--color-forest-deep);
    color: var(--color-paper);
  }
</style>
