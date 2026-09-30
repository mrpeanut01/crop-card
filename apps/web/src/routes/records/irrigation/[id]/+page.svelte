<script lang="ts">
  import CardView from '$lib/components/cards/CardView.svelte';
  import { currentPrefs } from '$lib/prefsState.svelte';

  const { data } = $props();
</script>

<svelte:head><title>Watering log · CropCard</title></svelte:head>

<div class="irrigation-record">
  <p class="back"><a href="/records?watering=1">Back to the watering log</a></p>
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
