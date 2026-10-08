<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { FALLBACK_RATE_LINE } from '$lib/plugins/rateProvenance';
</script>

<small class="fallback-rate" data-testid="fallback-rate-line"
  ><Provenance source="fallback" compact /><span lang="en" data-english-only="safety"
    >{FALLBACK_RATE_LINE}</span
  ></small
>

<style>
  .fallback-rate {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
    font-size: 0.85rem;
    color: var(--color-rust, #a23a3a);
  }
</style>
