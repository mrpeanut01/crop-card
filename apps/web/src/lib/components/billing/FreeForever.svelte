<script lang="ts">
  import { ShieldCheck } from 'lucide-svelte';
  import { FREE_FOREVER_FEATURES } from '$lib/billing/plans';
</script>

<section class="free" aria-labelledby="free-forever-title" data-testid="free-forever">
  <h3 id="free-forever-title">
    <ShieldCheck size={18} strokeWidth={1.75} aria-hidden="true" />
    Free forever: records, safety, exports
  </h3>
  <p class="lede">
    Spray records are a legal need, so nothing that keeps you safe or compliant is ever behind a
    plan. If a paid plan ends, every record stays readable, writable and exportable.
  </p>
  <ul>
    {#each FREE_FOREVER_FEATURES as line (line)}
      <li>{line}</li>
    {/each}
  </ul>
</section>

<style>
  .free {
    padding: 16px 18px;
    border-radius: 10px;
    background: #e5eedf;
    border: 1px solid #c9dbc0;
    color: #1f3a28;
  }
  h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-serif, serif);
    font-size: 18px;
  }
  .lede {
    margin: 6px 0 8px;
    font-size: 13.5px;
    line-height: 1.5;
  }
  ul {
    margin: 0;
    padding-left: 20px;
    font-size: 13px;
    line-height: 1.6;
  }
</style>
