<script lang="ts">
  import { createT } from '$lib/i18n';
  import '$lib/components/finance/finance.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import EntryForm from '$lib/components/finance/EntryForm.svelte';

  const { data } = $props();
  const tr = $derived(createT(data.locale));
</script>

<svelte:head><title>{tr('finance.pageTitleAdd')}</title></svelte:head>

<div class="fin-page">
  <header>
    <Kicker>{tr('finance.kicker')}</Kicker>
    <h1 class="serif">
      {data.value.kind === 'income' ? tr('finance.new.addIncome') : tr('finance.new.addExpense')}
    </h1>
  </header>
  {#if data.alreadyExpensed}
    <p class="fin-note" role="status">
      {tr('finance.new.alreadyExpensed')}
      <a href="/finance/entries/{data.alreadyExpensed}">{tr('finance.new.openEntry')}</a>
      {tr('finance.new.insteadNote')}
    </p>
  {:else}
    <EntryForm
      initial={data.value}
      options={data.options}
      linkNote={data.linkNote}
      backHref={data.backHref}
    />
  {/if}
</div>
