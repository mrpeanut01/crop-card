<script lang="ts">
  import { createT } from '$lib/i18n';
  import CardView from '$lib/components/cards/CardView.svelte';
  import { currentPrefs } from '$lib/prefsState.svelte';

  const { data } = $props();
  const tr = $derived(createT(data.locale));
</script>

<svelte:head><title>{tr('records.irrigation.pageTitle')}</title></svelte:head>

<div class="irrigation-record">
  <p class="back"><a href="/records?watering=1">{tr('records.irrigation.back')}</a></p>
  <CardView card={data.card} prefs={currentPrefs()} />
</div>

<style>
  .irrigation-record {
    max-width: 640px;
    margin: 0 auto;
    padding: 1rem;
  }
  .back a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
</style>
