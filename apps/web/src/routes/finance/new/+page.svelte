<script lang="ts">
  import '$lib/components/finance/finance.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import EntryForm from '$lib/components/finance/EntryForm.svelte';

  const { data } = $props();
</script>

<svelte:head><title>Add money · CropCard</title></svelte:head>

<div class="fin-page">
  <header>
    <Kicker>Money · owner only</Kicker>
    <h1 class="serif">{data.value.kind === 'income' ? 'Add income.' : 'Add an expense.'}</h1>
  </header>
  {#if data.alreadyExpensed}
    <p class="fin-note" role="status">
      This lot already has a purchase expense.
      <a href="/finance/entries/{data.alreadyExpensed}">Open that entry</a> instead, so it is not counted
      twice.
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
